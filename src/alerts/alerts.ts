/**
 * Tells a person that something needs their attention: a booking that could
 * not be settled, a cancellation with an unknown outcome, a final price
 * above what was approved, an audit log that cannot be written.
 *
 * An alert carries only references and a reason. Never guest names, emails,
 * phones or prices: the receiving tool (n8n, Slack, email) is outside this
 * service.
 */
export type AlertEvent = 'BOOKING_NEEDS_REVIEW' | 'CANCEL_OUTCOME_UNKNOWN' | 'PRICE_MISMATCH' | 'AUDIT_WRITE_FAILED';

export interface Alert {
  event: AlertEvent;
  clientReference?: string;
  supplierId?: string;
  status?: string;
  reason: string;
}

export interface AlertSink {
  /** Never throws and never blocks the caller. */
  send(alert: Alert): void;
}

export class NullAlertSink implements AlertSink {
  send(): void {}
}

/** For tests. */
export class InMemoryAlertSink implements AlertSink {
  readonly alerts: Alert[] = [];
  send(alert: Alert): void {
    this.alerts.push(alert);
  }
}

export interface WebhookAlertOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** POSTs each alert as JSON to one https URL (e.g. an n8n webhook). */
export class WebhookAlertSink implements AlertSink {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly log: (msg: string) => void;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(url: string, opts: WebhookAlertOptions = {}) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      /* handled below */
    }
    if (!parsed || parsed.protocol !== 'https:') throw new Error('The alert webhook must be an https URL');
    this.url = parsed.toString();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? ((m) => console.error(m));
  }

  send(alert: Alert): void {
    // Copy field by field: nothing else on the object may leave the service.
    const body = JSON.stringify({
      service: 'apolles-suppliers',
      at: this.now().toISOString(),
      event: alert.event,
      clientReference: alert.clientReference,
      supplierId: alert.supplierId,
      status: alert.status,
      reason: String(alert.reason).slice(0, 500),
    });
    const p = this.post(body, alert.event).finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  /** Wait for alerts on their way (shutdown, tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  private async post(body: string, event: string): Promise<void> {
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) this.log(`Alert ${event} not sent: webhook answered HTTP ${res.status}`);
    } catch (err) {
      // An alert that cannot be sent must never break a booking.
      this.log(`Alert ${event} not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** ALERT_WEBHOOK_URL is optional. When set it must be https, checked at startup. */
export function alertSinkFromEnv(env: NodeJS.ProcessEnv): AlertSink {
  const url = env['ALERT_WEBHOOK_URL'];
  if (!url) return new NullAlertSink();
  try {
    return new WebhookAlertSink(url);
  } catch {
    throw new Error('ALERT_WEBHOOK_URL must be an https URL');
  }
}
