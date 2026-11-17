/**
 * Removes secrets and card data from anything before it is logged or stored.
 * Applied by the transport to every request/response body and header.
 */

const MASK = '***';

/** Element / attribute / JSON key names whose value is always masked. */
const SENSITIVE_NAMES = [
  'password', 'messagepassword', 'passwd', 'pwd', 'secret', 'apikey', 'api_key', 'token',
  'accesstoken', 'access_token', 'clientsecret', 'client_secret',
  'cardnumber', 'card_number', 'cardno', 'pan', 'cvv', 'cvc', 'cv2', 'seriescode', 'securitycode',
  'expiredate', 'expirydate', 'expiry', 'expiration',
];

const NAMES_RE = SENSITIVE_NAMES.join('|');

// XML attribute: Password="x"  /  ns:CardNumber='x'
const XML_ATTR = new RegExp(`(\\b(?:[\\w-]+:)?(?:${NAMES_RE})\\s*=\\s*)("[^"]*"|'[^']*')`, 'gi');
// XML element: <Password>x</Password> or <ns:CardNumber>x</ns:CardNumber>
const XML_ELEM = new RegExp(`(<((?:[\\w-]+:)?(?:${NAMES_RE}))\\b[^>]*>)([^<]*)(</\\2>)`, 'gi');
// JSON: "password": "x"  or "cvv": 123
const JSON_KV = new RegExp(`("(?:${NAMES_RE})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+)`, 'gi');
// Query string: ?password=x&
const QUERY_KV = new RegExp(`([?&](?:${NAMES_RE})=)([^&#\\s]*)`, 'gi');

const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'apikey', 'x-signature']);

export function redactText(text: string): string {
  if (!text) return text;
  return maskCardNumbers(
    text
      .replace(XML_ATTR, (_m, pre: string, val: string) => `${pre}${val[0]}${MASK}${val[0]}`)
      .replace(XML_ELEM, (_m, open: string, _name: string, _val: string, close: string) => `${open}${MASK}${close}`)
      .replace(JSON_KV, (_m, pre: string) => `${pre}"${MASK}"`)
      .replace(QUERY_KV, (_m, pre: string) => `${pre}${MASK}`),
  );
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? MASK : v;
  }
  return out;
}

/**
 * Any 13-19 digit run (spaces/dashes allowed) that passes the Luhn check is
 * treated as a card number and masked, keeping only the last 4 digits.
 */
export function maskCardNumbers(text: string): string {
  return text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return match;
    return `${MASK}${digits.slice(-4)}`;
  });
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
