// Result of a settings form post, shown above the form. On an error, `values` holds what the
// agent typed, so the form can show it again instead of going back to the saved values.
export type SettingsFormState =
  | { status: "success"; message: string }
  | { status: "error"; message: string; values?: Record<string, string> }
  | null;
