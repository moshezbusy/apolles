/**
 * Card data never lives in Apolles' database or logs. Bookings carry only a
 * card TOKEN. An adapter that must send a card to the supplier (OTA
 * guarantee) asks the vault for it inside `withCard`, uses it for the single
 * request, and drops it.
 *
 * Production: implement this against a PCI-compliant tokenization provider
 * (virtual card issuer such as the bank's VCC API, or a vault like
 * Basis Theory / VGS / Stripe Issuing). Apolles itself then stays out of
 * PCI scope for storage.
 */
export interface CardDetails {
  /** Card brand code as OTA expects it: VI, MC, AX, ... */
  brandCode: string;
  number: string;
  /** MMYY */
  expiry: string;
  cvc?: string;
  holderName: string;
}

export interface CardVault {
  withCard<T>(token: string, use: (card: CardDetails) => Promise<T>): Promise<T>;
}

/** Refuses every card request. Default until a real vault is configured. */
export class NoCardVault implements CardVault {
  async withCard<T>(): Promise<T> {
    throw new Error('No card vault configured: card payments are disabled');
  }
}

/** For tests only. */
export class InMemoryCardVault implements CardVault {
  constructor(private readonly cards: Record<string, CardDetails>) {}
  async withCard<T>(token: string, use: (card: CardDetails) => Promise<T>): Promise<T> {
    const card = this.cards[token];
    if (!card) throw new Error('Unknown card token');
    return use({ ...card });
  }
}
