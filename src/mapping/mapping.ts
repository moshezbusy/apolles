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

export async function loadMappingDir(dir: string): Promise<InMemoryMappingStore> {
  const store = new InMemoryMappingStore();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return store;
  }
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const file = JSON.parse(await readFile(join(dir, name), 'utf8')) as SupplierMappingFile;
    store.load(file);
  }
  return store;
}
