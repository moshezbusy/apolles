// Result of "Mark done" on one change request.
export type ChangeRequestFormState = { status: "success" | "info" | "error"; message: string } | null;
