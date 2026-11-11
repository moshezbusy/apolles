import { db } from "@/server/db";

// Demo destinations and hotels for staging while there are no Expedia test keys
// (SUPPLIER_MODE=fake). Every id starts with "demo-", so real data is never touched, and
// running it again changes nothing. Rates and hotel content come from the fake supplier.

const DESTINATIONS: { id: string; name: string; nameFull: string; countryCode: string; hotels: string[] }[] = [
  { id: "demo-paris", name: "Paris", nameFull: "Paris, Ile-de-France, France", countryCode: "FR", hotels: ["Hotel Lumiere", "Maison Rivoli", "Le Grand Opera", "Hotel Saint-Germain", "Residence Montmartre", "Hotel du Louvre Garden", "Le Marais Boutique"] },
  { id: "demo-rome", name: "Rome", nameFull: "Rome, Lazio, Italy", countryCode: "IT", hotels: ["Palazzo Navona", "Hotel Trevi Corner", "Villa Borghese Suites", "Albergo Pantheon", "Trastevere House", "Hotel Colosseo View"] },
  { id: "demo-barcelona", name: "Barcelona", nameFull: "Barcelona, Catalonia, Spain", countryCode: "ES", hotels: ["Hotel Rambla Mar", "Casa Gracia", "Eixample Grand", "Barceloneta Beach Hotel", "Gothic Quarter Inn", "Hotel Montjuic"] },
  { id: "demo-london", name: "London", nameFull: "London, England, United Kingdom", countryCode: "GB", hotels: ["The Covent Hotel", "Kensington Gardens Hotel", "Southbank Riverside", "Mayfair House", "Camden Lofts", "The Bloomsbury"] },
  { id: "demo-athens", name: "Athens", nameFull: "Athens, Attica, Greece", countryCode: "GR", hotels: ["Acropolis View Hotel", "Plaka Suites", "Syntagma Central", "Kolonaki Boutique", "Athens Riviera Resort"] },
  { id: "demo-dubai", name: "Dubai", nameFull: "Dubai, United Arab Emirates", countryCode: "AE", hotels: ["Marina Pearl Hotel", "Downtown Skyline Suites", "Palm Beach Resort", "Old Dubai Heritage Inn", "Business Bay Tower Hotel"] },
];

const STARS = ["5.0", "4.5", "4.0", "3.5", "3.0", "4.0", "5.0"];

export async function seedDemoContent(): Promise<{ destinations: number; hotels: number }> {
  let hotels = 0;
  for (const d of DESTINATIONS) {
    await db.$transaction(async (tx) => {
      await tx.destination.upsert({
        where: { id: d.id },
        create: { id: d.id, name: d.name, nameFull: d.nameFull, type: "city", countryCode: d.countryCode, propertyCount: d.hotels.length, active: true, seenRunId: "demo" },
        update: { name: d.name, nameFull: d.nameFull, countryCode: d.countryCode, propertyCount: d.hotels.length, active: true },
      });
      for (const [rank, name] of d.hotels.entries()) {
        const id = `${d.id}-${rank + 1}`;
        const data = { name, city: d.name, countryCode: d.countryCode, starRating: STARS[rank % STARS.length]!, rank, expediaCollect: true, active: true };
        await tx.property.upsert({ where: { id }, create: { id, ...data, catalogSeenRunId: "demo" }, update: data });
        await tx.destinationProperty.upsert({
          where: { destinationId_propertyId: { destinationId: d.id, propertyId: id } },
          create: { destinationId: d.id, propertyId: id },
          update: {},
        });
        hotels++;
      }
    });
  }
  return { destinations: DESTINATIONS.length, hotels };
}
