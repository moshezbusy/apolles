// Contact and terms details shown in the booking pages (ER2, GR2, GR3). They are business
// settings from the environment, not secrets; a missing one is shown as "not set yet" instead
// of a made-up value.

function httpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function supportContact(): { email: string | null; phone: string | null } {
  return { email: process.env.APOLLES_SUPPORT_EMAIL || null, phone: process.env.APOLLES_SUPPORT_PHONE || null };
}

// Apolles' agent terms (our page) and the supplier's terms (an https link Expedia gives us).
export function termsLinks(): { agentTerms: string; supplierTerms: string | null } {
  return { agentTerms: "/terms", supplierTerms: httpsUrl(process.env.SUPPLIER_TERMS_URL) };
}
