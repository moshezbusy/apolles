// What a client form gets back from its server action. After an error the typed values come back,
// so the form shows them again instead of resetting.
export type ClientFormState =
  | null
  | { status: "success"; message: string }
  | { status: "error"; message: string; values?: Record<string, string> };
