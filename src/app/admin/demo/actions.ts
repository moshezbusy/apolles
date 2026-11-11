"use server";

import { requireAdmin } from "@/server/auth/guards";
import { resetDemoAgentPassword } from "@/server/content/demo-seed";
import { isDemoSupplier } from "@/server/supplier";

export type DemoAccessState = { status: "ok"; email: string; password: string } | { status: "error"; message: string } | null;

// "Create demo login" (staging demo only): a new password for the demo agent, shown once.
export async function demoAccessAction(): Promise<DemoAccessState> {
  const { userId } = await requireAdmin();
  if (!isDemoSupplier()) return { status: "error", message: "Demo access exists only in the staging demo." };
  const appUrl = process.env.APP_URL;
  if (!appUrl) return { status: "error", message: "APP_URL is not set." };
  const { email, password } = await resetDemoAgentPassword(userId, appUrl);
  return { status: "ok", email, password };
}
