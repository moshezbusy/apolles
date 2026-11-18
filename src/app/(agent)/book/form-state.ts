// Result of the guest details and book posts. On an error the form shows the message and what
// the agent typed (guest names, email, phone), so nothing has to be typed again.
export type BookFormState = { status: "error"; message: string; values?: Record<string, string> } | null;

const MAX_GUESTS = 14;

function text(value: FormDataEntryValue | null, max = 100): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// Only the known fields are read (the form also carries Next.js internals).
export function readGuestForm(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["s", "p", "r", "b", "stay", "saveClient", "clientId", "leadEmail", "phoneCountry", "phoneNumber"]) values[key] = text(formData.get(key), 254);
  values.requestText = text(formData.get("requestText"), 300);
  // The ticked special requests, kept as one comma list (known names only, checked on the server).
  values.requests = formData
    .getAll("requests")
    .filter((v): v is string => typeof v === "string")
    .slice(0, 4)
    .map((v) => v.slice(0, 20))
    .join(",");
  for (let i = 0; i < MAX_GUESTS; i++) {
    if (!formData.has(`given_${i}`) && !formData.has(`family_${i}`)) break;
    values[`given_${i}`] = text(formData.get(`given_${i}`), 60);
    values[`family_${i}`] = text(formData.get(`family_${i}`), 60);
    values[`title_${i}`] = text(formData.get(`title_${i}`), 3);
  }
  return values;
}

export function toDraftInput(values: Record<string, string>) {
  const guests: { givenName: string; familyName: string; title?: string }[] = [];
  for (let i = 0; values[`given_${i}`] !== undefined; i++) {
    const title = values[`title_${i}`];
    guests.push({ givenName: values[`given_${i}`]!, familyName: values[`family_${i}`] ?? "", ...(title ? { title } : {}) });
  }
  return {
    snapshotId: values.s ?? "",
    propertyId: values.p ?? "",
    rateId: values.r ?? "",
    bedGroupId: values.b ?? "",
    guests,
    leadEmail: values.leadEmail ?? "",
    specialRequests: { options: (values.requests ?? "").split(",").filter(Boolean), text: values.requestText ?? "" },
    // Plan 5d: only sent when the agent books from a quote.
    ...(values.stay ? { quoteStayId: values.stay } : {}),
    // Spaces, dashes and brackets are allowed in what the agent types; only digits are kept.
    leadPhone: { countryCode: (values.phoneCountry ?? "").replace(/\D/g, ""), number: (values.phoneNumber ?? "").replace(/[\s().-]/g, "") },
  };
}
