import { getClientIp, UNKNOWN_IP } from "@/server/client-ip";
import type { SupplierContext } from "@/server/supplier/types";

// The agent's IP and browser, which Rapid asks for on shopping and booking calls
// (Customer-Ip, User-Agent). Never our own server's values.
export function supplierContextFrom(headers: { get(name: string): string | null }): SupplierContext {
  const ip = getClientIp(headers);
  const userAgent = headers.get("user-agent")?.slice(0, 255);
  return { ...(ip !== UNKNOWN_IP ? { customerIp: ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
