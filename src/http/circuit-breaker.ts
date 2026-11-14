/**
 * When a supplier keeps failing, stop sending it search traffic for a while
 * so one broken supplier never slows down the whole search.
 * Only searches consult the breaker; bookings always go through.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly coolDownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get isOpen(): boolean {
    if (this.failures < this.failureThreshold) return false;
    if (this.now() - this.openedAt >= this.coolDownMs) {
      // half-open: let one call through; a failure re-opens immediately
      this.failures = this.failureThreshold - 1;
      return false;
    }
    return true;
  }

  success(): void {
    this.failures = 0;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }
}
