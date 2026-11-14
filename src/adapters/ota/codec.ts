import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export const OTA_NS = 'http://www.opentravel.org/OTA/2003/05';
const SOAP11_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope';
const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';

/** Elements that can repeat in OTA messages: always parsed as arrays. */
const ARRAY_TAGS = new Set([
  'RoomStay', 'RoomType', 'RatePlan', 'RoomRate', 'Rate', 'GuestCount', 'CancelPenalty', 'Error', 'Warning',
  'HotelReservation', 'HotelReservationID', 'UniqueID', 'RoomStayCandidate', 'Criterion', 'HotelRef', 'ResGuest',
  'Text', 'Tax', 'Fee', 'PenaltyDescription', 'CancelRule', 'Comment', 'ResGuestRPH', 'RatePlanCandidate',
]);

export type XmlNode = Record<string, unknown>;

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
  format: false,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export function buildXml(root: string, body: XmlNode): string {
  return builder.build({ [root]: body }) as string;
}

export function wrapEnvelope(
  xml: string,
  envelope: 'plain' | 'soap11' | 'soap12',
  wsse?: { username: string; password: string },
): string {
  if (envelope === 'plain') return `<?xml version="1.0" encoding="UTF-8"?>${xml}`;
  const ns = envelope === 'soap11' ? SOAP11_NS : SOAP12_NS;
  const header = wsse
    ? `<soap:Header>${builder.build({
        'wsse:Security': {
          '@_xmlns:wsse': WSSE_NS,
          'wsse:UsernameToken': { 'wsse:Username': wsse.username, 'wsse:Password': wsse.password },
        },
      })}</soap:Header>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${ns}">${header}<soap:Body>${xml}</soap:Body></soap:Envelope>`;
}

export class XmlProtocolError extends Error {}

/**
 * Parse a supplier XML response and return the OTA root element (inside a
 * SOAP envelope if there is one). DOCTYPE/ENTITY declarations are refused
 * outright (XXE / entity-expansion protection).
 */
export function parseOtaResponse(body: string, expectedRoots: string[]): { root: string; node: XmlNode } {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new XmlProtocolError('Response contains DOCTYPE/ENTITY; refused');
  let doc: XmlNode;
  try {
    doc = parser.parse(body) as XmlNode;
  } catch (err) {
    throw new XmlProtocolError(`Invalid XML: ${(err as Error).message}`);
  }
  let container: XmlNode = doc;
  const env = doc['Envelope'] as XmlNode | undefined;
  if (env) {
    const soapBody = (env['Body'] ?? {}) as XmlNode;
    if (soapBody['Fault']) {
      const f = soapBody['Fault'] as XmlNode;
      throw new XmlProtocolError(`SOAP fault: ${text(f['faultstring']) ?? text((f['Reason'] as XmlNode)?.['Text']) ?? 'unknown'}`);
    }
    container = soapBody;
  }
  for (const r of expectedRoots) {
    const node = container[r];
    if (node && typeof node === 'object') return { root: r, node: node as XmlNode };
    if (node === '') return { root: r, node: {} };
  }
  throw new XmlProtocolError(`Unexpected response, expected one of ${expectedRoots.join(', ')}`);
}

// ---- small helpers for reading parsed nodes --------------------------------

export function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const v = (node as XmlNode)[`@_${name}`];
  return v === undefined || v === null ? undefined : String(v);
}

export function child(node: unknown, name: string): XmlNode | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const v = (node as XmlNode)[name];
  if (Array.isArray(v)) return v[0] as XmlNode | undefined;
  if (v === '') return {};
  return v && typeof v === 'object' ? (v as XmlNode) : undefined;
}

export function children(node: unknown, name: string): XmlNode[] {
  if (!node || typeof node !== 'object') return [];
  const v = (node as XmlNode)[name];
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (x && typeof x === 'object' ? (x as XmlNode) : x === '' ? {} : ({ '#text': String(x) } as XmlNode)));
}

/** Follow a path of element names, e.g. path(n, 'RoomStays', 'RoomStay'). */
export function path(node: unknown, ...names: string[]): XmlNode[] {
  let current: XmlNode[] = node && typeof node === 'object' ? [node as XmlNode] : [];
  for (const n of names) current = current.flatMap((c) => children(c, n));
  return current;
}

export function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).filter(Boolean).join(' ') || undefined;
  if (typeof node === 'object') {
    const t = (node as XmlNode)['#text'];
    return t === undefined ? undefined : String(t);
  }
  return undefined;
}
