import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Admin · Apolles", robots: { index: false, follow: false } };

// Entry point after an admin signs in: requireAdmin sends them through TOTP first.
export default async function AdminHome() {
  await requireAdmin();
  redirect("/admin/agencies");
}
