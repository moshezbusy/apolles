// Result of the search form post. On an error the form shows the message and what the agent
// had entered, so nothing has to be typed again.
export type SearchFormValues = {
  destinationId: string;
  destinationLabel: string;
  checkin: string;
  checkout: string;
  adults: string;
  childCount: string;
  childAges: string[];
};

export type SearchFormState = { status: "error"; message: string; values: SearchFormValues } | null;

const MAX_FIELD = 100;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

// Only the known fields are read (the form also carries Next.js internals).
export function readSearchForm(formData: FormData): SearchFormValues {
  return {
    destinationId: text(formData.get("destinationId")),
    destinationLabel: text(formData.get("destinationLabel")),
    checkin: text(formData.get("checkin")),
    checkout: text(formData.get("checkout")),
    adults: text(formData.get("adults")),
    childCount: text(formData.get("childCount")),
    childAges: formData.getAll("childAge").slice(0, 10).map(text),
  };
}

// Numbers for the search schema: anything that is not a whole number becomes NaN, which the
// schema refuses (never a silent 0).
export function toSearchInput(values: SearchFormValues) {
  const int = (s: string) => (/^\d{1,2}$/.test(s) ? Number(s) : Number.NaN);
  return {
    destinationId: values.destinationId,
    checkin: values.checkin,
    checkout: values.checkout,
    adults: int(values.adults),
    childAges: values.childAges.map(int),
  };
}

// Every child the agent added must have an age: a missing one is refused, never dropped
// (it would price the room for fewer guests).
export function childAgesComplete(values: SearchFormValues): boolean {
  const count = values.childCount === "" ? 0 : /^\d{1,2}$/.test(values.childCount) ? Number(values.childCount) : -1;
  return count === values.childAges.length && values.childAges.every((age) => age !== "");
}
