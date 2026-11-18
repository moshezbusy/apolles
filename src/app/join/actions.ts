"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { submitApplication } from "@/server/applications";
import { getClientIp } from "@/server/client-ip";

export type JoinState = { error: string; values: Record<string, string> } | null;

const FIELDS = ["agencyName", "contactName", "email", "phone", "country", "website", "license", "notes", "terms", "company"];

// "Apply for Access" (screen 02). Public: everything is checked in the service, and limited per
// IP and per email. Nothing about the applicant is logged.
export async function joinAction(_previous: JoinState, formData: FormData): Promise<JoinState> {
  const values: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = formData.get(key);
    values[key] = typeof v === "string" ? v.slice(0, key === "notes" ? 1200 : 300) : "";
  }
  const result = await submitApplication(values, getClientIp(await headers()));
  if (result.ok) redirect("/join/received");
  const error =
    result.error === "limited"
      ? "Too many applications from your network. Try again later."
      : "Check the form: agency and contact name, a valid business email, a phone with 7 to 15 digits, a country, a website or social page, and the terms.";
  // What the agent typed comes back to the form (the hidden bot field never does).
  return { error, values: Object.fromEntries(Object.entries(values).filter(([key]) => key !== "company")) };
}
