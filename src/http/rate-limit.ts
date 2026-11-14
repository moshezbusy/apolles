/** Simple token bucket: at most `perSecond` calls per second per supplier. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly perSecond: number, private readonly burst = perSecond) {
    this.tokens = burst;
  }

  take(signal?: AbortSignal): Promise<void> {
    const next = this.queue.then(() => this.waitForToken(signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async waitForToken(signal?: AbortSignal): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const t = setTimeout(resolve, waitMs);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
      });
    }
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
  }
}
