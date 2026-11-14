/**
 * Supplier credentials are never written in config files or code.
 * Config only holds the NAME of a secret; the value comes from here.
 * In production swap EnvSecretProvider for a real vault (Doppler, AWS/GCP
 * Secret Manager, 1Password) by implementing the same interface.
 */
export interface SecretProvider {
  get(name: string): string;
  has(name: string): boolean;
}

export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(name: string): string {
    const v = this.env[name];
    if (v === undefined || v === '') throw new Error(`Missing secret: ${name}`);
    return v;
  }

  has(name: string): boolean {
    const v = this.env[name];
    return v !== undefined && v !== '';
  }
}

export class StaticSecretProvider implements SecretProvider {
  constructor(private readonly values: Record<string, string>) {}
  get(name: string): string {
    const v = this.values[name];
    if (v === undefined) throw new Error(`Missing secret: ${name}`);
    return v;
  }
  has(name: string): boolean {
    return name in this.values;
  }
}
