import type { SupplierAdapter } from '../core/supplier.js';
import type { SupplierId } from '../core/types.js';
import { CircuitBreaker } from '../http/circuit-breaker.js';

export interface SupplierSettings {
  enabled: boolean;
  /** Whole-search budget for this supplier; slower answers are dropped. */
  searchTimeoutMs: number;
}

export interface RegisteredSupplier {
  adapter: SupplierAdapter;
  settings: SupplierSettings;
  breaker: CircuitBreaker;
}

export class SupplierRegistry {
  private readonly items = new Map<SupplierId, RegisteredSupplier>();

  register(adapter: SupplierAdapter, settings: Partial<SupplierSettings> = {}, breaker = new CircuitBreaker()): void {
    if (this.items.has(adapter.id)) throw new Error(`Supplier ${adapter.id} registered twice`);
    this.items.set(adapter.id, {
      adapter,
      settings: { enabled: settings.enabled ?? true, searchTimeoutMs: settings.searchTimeoutMs ?? 8_000 },
      breaker,
    });
  }

  get(id: SupplierId): RegisteredSupplier | undefined {
    return this.items.get(id);
  }

  require(id: SupplierId): RegisteredSupplier {
    const s = this.items.get(id);
    if (!s) throw new Error(`Unknown supplier ${id}`);
    return s;
  }

  all(): RegisteredSupplier[] {
    return [...this.items.values()];
  }
}
