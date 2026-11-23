"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guards";
import { CHANGE_NOTE_MAX_LENGTH, ChangeRequestNotAllowed, markChangeRequestDone } from "@/server/change-requests";
import type { ChangeRequestFormState } from "./form-state";

const fields = z.object({ requestId: z.string().min(1).max(64), note: z.string().max(CHANGE_NOTE_MAX_LENGTH * 2) }).strict();

// "Mark done" with the admin's note (what was changed at the supplier, or why not).
export async function markChangeRequestDoneAction(_previous: ChangeRequestFormState, formData: FormData): Promise<ChangeRequestFormState> {
  const { userId } = await requireAdmin();
  const parsed = fields.safeParse({ requestId: formData.get("requestId"), note: formData.get("note") ?? "" });
  if (!parsed.success) return { status: "error", message: `Keep the note under ${CHANGE_NOTE_MAX_LENGTH} characters and try again.` };
  try {
    switch (await markChangeRequestDone(userId, parsed.data.requestId, parsed.data.note)) {
      case "done":
        return { status: "success", message: "Marked done." };
      case "already":
        return { status: "info", message: "This request was already marked done. Nothing changed." };
      case "not_found":
        return { status: "error", message: "This request was not found. Reload the page." };
    }
  } catch (caught) {
    if (caught instanceof ChangeRequestNotAllowed) return { status: "error", message: `Keep the note under ${CHANGE_NOTE_MAX_LENGTH} characters and try again.` };
    throw caught;
  } finally {
    revalidatePath("/admin/change-requests", "page");
  }
}
