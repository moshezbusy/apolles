// What a quote form gets back from its server action: nothing (done, the page refreshes), a
// confirmation, or an error message to show next to the form. `confirm`: the change needs the
// agent's explicit yes: the form shows a tick box with this field name and label, and the same
// submit goes through once it is ticked.
export type ActionState =
  | null
  | { status: "success"; message: string; quoteId?: string }
  | { status: "error"; message: string; confirm?: { name: string; label: string } };
