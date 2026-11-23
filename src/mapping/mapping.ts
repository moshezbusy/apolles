import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoardCode, HotelId, SupplierId } from '../core/types.js';

/**
 * Maps our hotel ids to each supplier's hotel codes, and supplier board
 * codes to our board codes. The same hotel (e.g. one RIU resort) can be
 * reachable through several suppliers; mapping is what lets Apolles show
 * them side by side and pick the best price.
 */
export interface MappingStore {
  /** internal id -> supplier hotel code, only for hotels this supplier has. */
  supplierHotelCodes(supplierId: SupplierId, hotelIds: HotelId[]): Promise<Map<HotelId, string>>;
  hotelIdFor(supplierId: SupplierId, supplierHotelCode: string): Promise<HotelId | undefined>;
  board(supplierId: SupplierId, rawCode: string | undefined): Promise<BoardCode>;
}

/** File format of config/mappings/<supplierId>.json */
export interface SupplierMappingFile {
  supplierId: SupplierId;
  /** internal hotel id -> supplier hotel code */
  hotels: Record<HotelId, string>;
  /** supplier board code -> our board code */
  boards?: Record<string, BoardCode>;
}

export class InMemoryMappingStore implements MappingStore {
  private readonly hotels = new Map<SupplierId, Map<HotelId, string>>();
  private readonly reverse = new Map<SupplierId, Map<string, HotelId>>();
  private readonly boards = new Map<SupplierId, Map<string, BoardCode>>();

  constructor(files: SupplierMappingFile[] = []) {
    for (const f of files) this.load(f);
  }

  load(file: SupplierMappingFile): void {
    const fwd = new Map<HotelId, string>();
    const rev = new Map<string, HotelId>();
    for (const [hotelId, code] of Object.entries(file.hotels)) {
      if (rev.has(code)) {
        throw new Error(`Mapping ${file.supplierId}: supplier code ${code} mapped to two hotels`);
      }
      fwd.set(hotelId, code);
      rev.set(code, hotelId);
    }
    this.hotels.set(file.supplierId, fwd);
    this.reverse.set(file.supplierId, rev);
    this.boards.set(file.supplierId, new Map(Object.entries(file.boards ?? {}).map(([k, v]) => [k.toUpperCase(), v])));
  }

  /** How many hotels are mapped for a supplier (0 = its searches can never return anything). */
  hotelCount(supplierId: SupplierId): number {
    return this.hotels.get(supplierId)?.size ?? 0;
  }

  async supplierHotelCodes(supplierId: SupplierId, hotelIds: HotelId[]): Promise<Map<HotelId, string>> {
    const fwd = this.hotels.get(supplierId);
    const out = new Map<HotelId, string>();
    if (!fwd) return out;
    for (const id of hotelIds) {
      const code = fwd.get(id);
      if (code) out.set(id, code);
    }
    return out;
  }

  async hotelIdFor(supplierId: SupplierId, code: string): Promise<HotelId | undefined> {
    return this.reverse.get(supplierId)?.get(code);
  }

  async board(supplierId: SupplierId, rawCode: string | undefined): Promise<BoardCode> {
    if (!rawCode) return 'OTHER';
    return this.boards.get(supplierId)?.get(rawCode.toUpperCase()) ?? 'OTHER';
  }
}

const BOARDS: ReadonlySet<string> = new Set(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI', 'OTHER']);

/**
 * Loads every <supplier>.json in the directory. A missing directory or a
 * broken file stops startup: starting without mappings would make every
 * search come back empty with no hint why.
 */
export async function loadMappingDir(dir: string): Promise<InMemoryMappingStore> {
  const store = new InMemoryMappingStore();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    throw new Error(`Mappings directory ${dir} cannot be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const seen = new Set<string>();
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, name);
    let file: unknown;
    try {
      file = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      throw new Error(`Mapping file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const problem = mappingProblem(file);
    if (problem) throw new Error(`Mapping file ${path}: ${problem}`);
    const mappingFile = file as SupplierMappingFile;
    if (seen.has(mappingFile.supplierId)) throw new Error(`Mapping file ${path}: supplier ${mappingFile.supplierId} already has a mapping file`);
    seen.add(mappingFile.supplierId);
    try {
      store.load(mappingFile);
    } catch (err) {
      throw new Error(`Mapping file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return store;
}

function mappingProblem(file: unknown): string | undefined {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(file)) return 'must be a JSON object';
  if (typeof file['supplierId'] !== 'string' || !file['supplierId']) return 'supplierId is required';
  const hotels = file['hotels'];
  if (!isObject(hotels)) return '"hotels" must be an object: our hotel id -> supplier hotel code';
  for (const [id, code] of Object.entries(hotels)) {
    if (typeof code !== 'string' || !code) return `hotel ${id}: the supplier code must be text, e.g. "377201"`;
  }
  const boards = file['boards'];
  if (boards !== undefined) {
    if (!isObject(boards)) return '"boards" must be an object: supplier board code -> our board code';
    for (const [raw, board] of Object.entries(boards)) {
      if (typeof board !== 'string' || !BOARDS.has(board)) return `board ${raw}: must be one of ${[...BOARDS].join(', ')}`;
    }
  }
  return undefined;
}
