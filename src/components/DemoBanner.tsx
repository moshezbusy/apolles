import { connection } from "next/server";
import { isDemoSupplier } from "@/server/supplier";

// Shown on every page while the supplier is the fake one (staging demo, development): the
// hotels, prices and bookings are sample data. Read at request time, never at build time.
export async function DemoBanner() {
  await connection();
  if (!isDemoSupplier()) return null;
  return (
    <div role="note" className="bg-[#fff2c7] px-4 py-2 text-center text-[13px] font-semibold text-[#6f5a20]">
      Demo mode: hotels, prices and bookings are sample data, not real. Nothing is booked with a hotel.
    </div>
  );
}
