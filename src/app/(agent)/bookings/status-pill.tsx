import type { BookingStatus } from "@/generated/prisma/client";
import { pillDot } from "@/components/ui";
import { STATUS_LABEL } from "@/server/booking/list";

// A booking's status as a coloured pill with a dot (mockups 12 and 13), the same on the bookings
// list and the booking page. A draft reads "Not finished": guest details entered, not booked yet.
const TONE: Record<BookingStatus, string> = {
  DRAFT: "bg-[#f1efe9] text-[#5f6863]",
  PENDING_CONFIRMATION: "bg-[#fff2c7] text-[#6f5a20]",
  CONFIRMED: "bg-brand-soft text-brand",
  FAILED: "bg-[#fbecea] text-[#9b3b2e]",
  CANCEL_PENDING: "bg-[#fff2c7] text-[#6f5a20]",
  CANCELLED: "bg-[#f1efe9] text-[#5f6863]",
  CANCELLED_BY_SUPPLIER: "bg-[#fbecea] text-[#9b3b2e]",
  EXPIRED: "bg-[#f1efe9] text-[#5f6863]",
};

export function BookingStatusPill({ status }: { status: BookingStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${TONE[status]}`}>
      <span aria-hidden="true" className={pillDot} />
      {status === "DRAFT" ? "Not finished" : STATUS_LABEL[status]}
    </span>
  );
}
