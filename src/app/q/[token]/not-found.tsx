import { Gone } from "./proposal";

// A client link that is unknown, withdrawn or of a suspended agency answers 404 with the client's
// own page (both languages), never the agent area's 404 (which links to search and bookings).
export default function ClientLinkNotFound() {
  return <Gone />;
}
