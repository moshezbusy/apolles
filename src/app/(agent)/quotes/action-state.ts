// What a quote form gets back from its server action: nothing (done, the page refreshes), a
// confirmation, or an error message to show next to the form.
export type ActionState =
  | null
  | { status: "success"; message: string; quoteId?: string }
  | { status: "error"; message: string };
