import { db } from "@/server/db";

// The hotel behind a result link of the AI connector (design §6), for the page that confirms it
// before anything is searched. Only a hotel that can still be booked (active, Expedia collect:
// the same test searchOneHotel makes); the page shows this name, never the one in the link.
export async function openLinkHotel(propertyId: string): Promise<{ name: string; city: string; starRating: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(propertyId)) return null;
  const property = await db.property.findFirst({
    where: { id: propertyId, active: true, expediaCollect: true },
    select: { name: true, city: true, starRating: true },
  });
  if (!property) return null;
  return { name: property.name, city: property.city, starRating: property.starRating === null ? null : property.starRating.toString() };
}
