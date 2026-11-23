import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { card, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { draftGuestValues } from "@/server/booking/drafts";
import { getBooking, getBookingRooms } from "@/server/booking/service";
import { roomTitle } from "../../../_components/guests";
import { shortDate } from "../../../search/parts";
import { Steps } from "../../../_components/steps";
import { updateDraftAction } from "../../actions";
import { GuestForm, type GuestFormRoom } from "../../new/guest-form";

export const metadata: Metadata = { title: "Edit guest details | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// "Edit guest details" from the review page (screen 11): the guest form again, filled from the
// agency's own draft. Saving changes that draft (no second one) and goes back to the review page,
// where the price is checked again as usual. A booking that is no longer a draft has its own page.
export default async function EditGuestsPage({ params }: { params: Params }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const booking = await getBooking(agencyId, id);
  if (!booking || booking.status === "EXPIRED") notFound();
  if (booking.status !== "DRAFT") redirect(`/bookings/${booking.id}`);
  const [values, stored] = await Promise.all([draftGuestValues(agencyId, booking.id), getBookingRooms(agencyId, booking.id)]);
  if (!values || stored.length === 0) notFound();
  const rooms: GuestFormRoom[] = stored.map((room, r) => ({
    heading: stored.length > 1 ? roomTitle(r, room) : null,
    guests: [...Array.from({ length: room.adults }, (_, i) => `Adult ${i + 1}`), ...room.childAges.map((age, i) => `Child ${i + 1} (age ${age})`)],
  }));
  return (
    <main className="mx-auto w-[min(900px,calc(100%-40px))] py-8">
      <section className={`${card} bg-white p-6`}>
        <Steps current={3} />
        <h1 className={pageTitle}>Edit guest details</h1>
        <p className="mb-5 mt-1 text-sm text-muted">
          {booking.hotelName} · {shortDate(booking.checkin)} to {shortDate(booking.checkout)}. Enter the traveler names exactly as they appear on their travel documents.
        </p>
        <GuestForm
          action={updateDraftAction}
          hidden={{ bookingId: booking.id }}
          rooms={rooms}
          prefill={null}
          initial={values}
          back={{ href: `/book/${booking.id}`, label: "Back to review" }}
          submitLabel="Save guest details"
        />
      </section>
    </main>
  );
}
