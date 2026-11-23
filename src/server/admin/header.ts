import { cookies } from "next/headers";
import type { AdminHeaderCounts } from "@/components/AdminHeader";
import { SESSION_COOKIE, getSession } from "@/server/auth/session";
import { adminHeaderCounts } from "@/server/admin/bookings";

// The admin header's counters, for the section layouts. Read only for a fully signed-in admin
// (password and TOTP for this session, as requireAdmin checks); anyone else gets none, and the
// page under the layout sends them on (each page calls requireAdmin() itself).
export async function countsForAdminHeader(): Promise<AdminHeaderCounts | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await getSession(token) : null;
  if (!session || session.user.role !== "ADMIN" || !session.user.totpConfirmedAt || !session.totpVerifiedAt) return null;
  return adminHeaderCounts();
}
