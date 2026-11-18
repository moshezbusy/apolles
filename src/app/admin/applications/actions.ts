"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveApplication, rejectApplication } from "@/server/applications";
import { requireAdmin } from "@/server/auth/guards";

export type ReviewState = { error: string } | null;

function idOf(formData: FormData): string {
  const id = formData.get("id");
  return typeof id === "string" ? id.slice(0, 64) : "";
}

// Approve: the agency and its agent user are made, and the agent gets the set-password email.
export async function approveAction(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
  const { userId } = await requireAdmin();
  const result = await approveApplication(userId, idOf(formData));
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/applications");
  revalidatePath("/admin/agencies");
  redirect(`/admin/agencies/${result.agencyId}/wallet${result.emailSent === false ? "?email=failed" : ""}`);
}

export async function rejectAction(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
  const { userId } = await requireAdmin();
  const result = await rejectApplication(userId, idOf(formData));
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/applications");
  redirect("/admin/applications?status=REJECTED");
}
