import { ExpediaAdapter } from "./expedia/adapter";
import { ExpediaBooking } from "./expedia/booking";
import { ExpediaContentSource } from "./expedia/content";
import { FakeContentSource, FakeSupplierAdapter } from "./fake";
import { HotelbedsLayer } from "./hotelbeds-layer/adapter";
import { readSupplierList } from "./hotelbeds-layer/config";
import { MultiSupplierAdapter } from "./multi";
import type { BookingSupplier, ContentSource, SupplierAdapter, SupplierId } from "./types";

// The one place that picks the supplier. Expedia always, except SUPPLIER_MODE=fake (made-up
// hotels and rates). The fake is allowed on a developer's machine, in the browser tests, and
// on staging as a labelled demo until Expedia's test keys arrive. It is never allowed with
// APP_ENV=production, nor in a production build that is not staging. A wrong setting stops
// the request at once.
// A second supplier (owner decision 2026-11-23): SUPPLIERS="expedia,hotelbeds" (or
// "fake,hotelbeds") adds Hotelbeds through the supplier layer to every search. Unset, nothing
// changes. SUPPLIERS may also name the main supplier; it must then agree with SUPPLIER_MODE.

function fakeRequested(): boolean {
  const mode = process.env.SUPPLIER_MODE ?? "";
  if (mode !== "" && mode !== "expedia" && mode !== "fake") throw new Error(`Unknown SUPPLIER_MODE "${mode}"`);
  const { main } = readSupplierList(process.env);
  if (main && mode !== "" && mode !== main) throw new Error("SUPPLIER_MODE and SUPPLIERS name different main suppliers");
  if ((main ?? (mode || "expedia")) !== "fake") return false;
  const appEnv = process.env.APP_ENV ?? "";
  if (appEnv === "production" || (process.env.NODE_ENV === "production" && appEnv !== "staging")) {
    throw new Error("The fake supplier is only for development, tests and the staging demo");
  }
  return true;
}

// Hotelbeds (through the supplier layer) searched next to the main supplier.
export function secondSupplierEnabled(): boolean {
  return readSupplierList(process.env).hotelbeds;
}

export function supplierAdapter(): SupplierAdapter {
  const main = fakeRequested() ? new FakeSupplierAdapter() : new ExpediaAdapter();
  return secondSupplierEnabled() ? new MultiSupplierAdapter(main, new HotelbedsLayer()) : main;
}

// Price check and booking together (the booking service needs both from the same supplier):
// the booking's own supplier. A Hotelbeds booking always goes to the supplier layer, also when
// SUPPLIERS no longer names it, so bookings made before still finish, cancel and get checked.
export function bookingSupplier(supplier: SupplierId = "expedia"): SupplierAdapter & BookingSupplier {
  if (supplier === "hotelbeds") return new HotelbedsLayer();
  if (fakeRequested()) return new FakeSupplierAdapter();
  const shop = new ExpediaAdapter();
  const booking = new ExpediaBooking();
  return {
    searchAvailability: (q, c) => shop.searchAvailability(q, c),
    priceCheck: (r, c) => shop.priceCheck(r, c),
    book: (i, c) => booking.book(i, c),
    findByAffiliateReference: (r, c) => booking.findByAffiliateReference(r, c),
    retrieve: (l, c) => booking.retrieve(l, c),
    cancelRoom: (l, c) => booking.cancelRoom(l, c),
  };
}

export function contentSource(): ContentSource {
  return fakeRequested() ? new FakeContentSource() : new ExpediaContentSource();
}

// True when pages must say that hotels, prices and bookings are sample data.
export function isDemoSupplier(): boolean {
  return fakeRequested();
}

// Plan 10: more than one room in a search and booking only while the fake supplier is on (the
// staging demo and tests). With Expedia it waits for a try on Expedia's test system: the Rapid
// spec does not say how two rooms of the same guests are priced. The form hides "+ Add a room" and
// the server refuses more than one room ("Several rooms are not available yet.").
export function multiRoomAllowed(): boolean {
  return isDemoSupplier();
}
