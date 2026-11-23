// Result of one admin action on a booking (admin booking page).
// success: done · info: nothing to do (already done, or not needed) · error: nothing changed.
export type BookingActionState = { status: "success" | "info" | "error"; message: string } | null;
