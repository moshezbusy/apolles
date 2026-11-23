// What a client form gets back from its server action. After an error the typed values come back,
// so the form shows them again instead of resetting. `duplicate`: another client of the agency
// has the same email or phone; the form links to it, and saving again saves anyway.
export type ClientFormState =
  | null
  | { status: "success"; message: string }
  | { status: "error"; message: string; values?: Record<string, string>; duplicate?: { id: string; name: string } };
