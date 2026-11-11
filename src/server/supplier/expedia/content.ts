import { z } from "zod";
import type { ContentSource, Image, PropertyContent, RegionInfo, RoomContent } from "@/server/supplier/types";
import { SupplierResponseInvalid } from "./adapter";
import { expediaRequest, recordUnknownFields } from "./client";
import { type ObjectFactory, ParseNotes, check } from "./parse";

// Expedia Rapid content calls (plan 2b, task 2): destinations (/regions), the hotel catalog file
// link (/files/properties/catalog), hotel content (/properties/content) and hotels that became
// inactive (/properties/inactive). Built from the official OpenAPI spec. Same validation rules as
// the shopping adapter: fields we use are checked, unknown ones dropped and named in the log, and
// one bad region or hotel is skipped, never fatal. Supplier text is kept as given (may hold HTML).

const LANGUAGE = "en-US";
const SUPPLY_SOURCE = "expedia";
const CONTENT_TIMEOUT_MS = 30_000;
const SHORT_TIMEOUT_MS = 15_000;
const MAX_IDS = 250;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_SIZES = ["1000px", "350px", "200px", "70px"]; // the largest available is used

function schemas(object: ObjectFactory) {
  const unused = z.unknown().optional();
  const text = z.string().optional();
  const region = object({
    id: z.string(),
    type: z.enum(["city", "multi_city_vicinity"]),
    name: z.string(),
    name_full: z.string(),
    country_code: z.string(),
    property_ids: z.array(z.string()).optional(),
    descriptor: unused,
    iata_airport_code: unused,
    iata_airport_metro_code: unused,
    country_subdivision_code: unused,
    coordinates: unused,
    associations: unused,
    ancestors: unused,
    descendants: unused,
    property_ids_expanded: unused,
    categories: unused,
    tags: unused,
  });
  const link = object({ method: z.string().optional(), href: z.string(), expires: unused });
  const image = object({
    hero_image: z.boolean().optional(),
    caption: text,
    category: unused,
    links: z.record(z.string(), link),
  });
  const amenity = object({ id: z.string(), name: z.string(), value: unused, categories: unused });
  const room = object({
    id: z.string(),
    name: z.string(),
    images: z.array(image).optional(),
    amenities: z.record(z.string(), amenity).optional(),
    occupancy: object({
      max_allowed: object({ total: z.number().int().optional(), children: unused, adults: unused }).optional(),
      age_categories: unused,
    }).optional(),
    descriptions: unused,
    bed_groups: unused,
    area: unused,
    views: unused,
  });
  const property = object({
    property_id: z.string(),
    name: z.string(),
    address: object({
      line_1: z.string(),
      line_2: unused,
      city: z.string(),
      state_province_code: unused,
      state_province_name: text,
      postal_code: text,
      country_code: z.string(),
      obfuscation_required: unused,
      localized: unused,
    }),
    ratings: object({ property: object({ rating: z.string(), type: unused }).optional(), guest: unused }).optional(),
    location: object({
      coordinates: object({ latitude: z.number(), longitude: z.number() }).optional(),
      obfuscated_coordinates: unused,
      obfuscation_required: unused,
    }).optional(),
    checkin: object({
      "24_hour": unused,
      begin_time: text,
      end_time: text,
      instructions: text,
      special_instructions: text,
      min_age: z.number().int().optional(),
    }).optional(),
    checkout: object({ time: text, instructions: unused }).optional(),
    fees: object({ mandatory: text, optional: text }).optional(),
    policies: object({ know_before_you_go: text }).optional(),
    descriptions: object({
      general: text,
      headline: text,
      amenities: unused,
      dining: unused,
      renovations: unused,
      national_ratings: unused,
      business_amenities: unused,
      rooms: unused,
      attractions: unused,
      location: unused,
    }).optional(),
    onsite_payments: object({ currency: text, types: unused }).optional(),
    images: z.array(image).optional(),
    amenities: z.record(z.string(), amenity).optional(),
    rooms: z.record(z.string(), z.unknown()).optional(), // checked one by one
    phone: unused,
    fax: unused,
    category: unused,
    business_model: unused,
    rank: unused,
    attributes: unused,
    rates: unused,
    dates: unused,
    statistics: unused,
    airports: unused,
    themes: unused,
    all_inclusive: unused,
    tax_id: unused,
    chain: unused,
    brand: unused,
    spoken_languages: unused,
    multi_unit: unused,
    payment_registration_recommended: unused,
    vacation_rental_details: unused,
    supply_source: unused,
    registry_number: unused,
  });
  return { region, room, property, catalogLink: link, inactive: object({ property_id: z.string() }) };
}

const lenient = schemas(z.object);
const strict = schemas(z.strictObject as unknown as ObjectFactory);
type RawImage = z.infer<typeof lenient.property>["images"] extends (infer I)[] | undefined ? I : never;

function toImage(raw: RawImage): Image | null {
  for (const size of IMAGE_SIZES) {
    const href = raw.links[size]?.href;
    if (href && href.startsWith("https://")) return { url: href, caption: raw.caption ?? null };
  }
  return null; // no https link: dropped
}

function toImages(raws: RawImage[] | undefined): { images: Image[]; hero: Image | null } {
  const images: Image[] = [];
  let hero: Image | null = null;
  for (const raw of raws ?? []) {
    const image = toImage(raw);
    if (!image) continue;
    images.push(image);
    if (raw.hero_image && !hero) hero = image;
  }
  return { images, hero: hero ?? images[0] ?? null };
}

const decimalString = (n: number) => (Number.isFinite(n) ? String(n) : null);

export class ExpediaContentSource implements ContentSource {
  async listRegions(q: { countryCode: string; next?: string }): Promise<{ regions: RegionInfo[]; next: string | null }> {
    if (!/^[A-Z]{2}$/.test(q.countryCode)) throw new Error("listRegions: invalid country code");
    const { data, logId, next } = await expediaRequest(
      q.next
        ? { method: "GET", path: q.next, context: {}, timeoutMs: CONTENT_TIMEOUT_MS }
        : {
            method: "GET",
            path: "/regions",
            query: {
              include: ["details", "property_ids"],
              type: ["city", "multi_city_vicinity"],
              country_code: q.countryCode,
              language: LANGUAGE,
              supply_source: SUPPLY_SOURCE,
            },
            context: {},
            timeoutMs: CONTENT_TIMEOUT_MS,
          },
    );
    const list = data ?? [];
    if (!Array.isArray(list)) throw new SupplierResponseInvalid("Expedia regions response is not a list");
    const notes = new ParseNotes();
    const regions: RegionInfo[] = [];
    list.forEach((raw, i) => {
      const region = check(lenient.region, strict.region, raw, `[${i}]`, notes);
      if (!region) return;
      regions.push({
        id: region.id,
        name: region.name,
        nameFull: region.name_full,
        type: region.type,
        countryCode: region.country_code,
        propertyIds: (region.property_ids ?? []).filter((id) => SAFE_ID.test(id)),
      });
    });
    await recordUnknownFields(logId, notes.names);
    return { regions, next };
  }

  async catalogLink(): Promise<{ href: string }> {
    const { data, logId } = await expediaRequest({
      method: "GET",
      path: "/files/properties/catalog",
      query: { language: LANGUAGE, supply_source: SUPPLY_SOURCE },
      context: {},
      timeoutMs: SHORT_TIMEOUT_MS,
    });
    const notes = new ParseNotes();
    const link = check(lenient.catalogLink, strict.catalogLink, data, "", notes);
    await recordUnknownFields(logId, notes.names);
    if (!link) throw new SupplierResponseInvalid("Expedia catalog link response is invalid");
    return { href: link.href };
  }

  async propertyContent(ids: string[]): Promise<PropertyContent[]> {
    if (ids.length < 1 || ids.length > MAX_IDS) throw new Error(`propertyContent takes 1 to ${MAX_IDS} ids`);
    if (!ids.every((id) => SAFE_ID.test(id))) throw new Error("propertyContent: invalid property id");
    const { data, logId } = await expediaRequest({
      method: "GET",
      path: "/properties/content",
      query: { property_id: ids, language: LANGUAGE, supply_source: SUPPLY_SOURCE },
      context: {},
      timeoutMs: CONTENT_TIMEOUT_MS,
    });
    const map = data ?? {};
    if (typeof map !== "object" || Array.isArray(map)) throw new SupplierResponseInvalid("Expedia content response is not an object");
    const notes = new ParseNotes();
    const result: PropertyContent[] = [];
    for (const [key, raw] of Object.entries(map as Record<string, unknown>)) {
      const p = check(lenient.property, strict.property, raw, key, notes);
      if (!p) continue;
      const { images, hero } = toImages(p.images);
      const rooms: RoomContent[] = [];
      for (const [roomKey, rawRoom] of Object.entries(p.rooms ?? {})) {
        const room = check(lenient.room, strict.room, rawRoom, `${key}.rooms.${roomKey}`, notes);
        if (!room) continue;
        rooms.push({
          id: room.id,
          name: room.name,
          images: toImages(room.images).images,
          amenities: Object.values(room.amenities ?? {}).map((a) => a.name),
          maxOccupancy: room.occupancy?.max_allowed?.total ?? null,
        });
      }
      const coords = p.location?.coordinates;
      const lat = coords ? decimalString(coords.latitude) : null;
      const lng = coords ? decimalString(coords.longitude) : null;
      result.push({
        propertyId: p.property_id,
        name: p.name,
        address: {
          line1: p.address.line_1,
          city: p.address.city,
          stateProvince: p.address.state_province_name ?? null,
          postalCode: p.address.postal_code ?? null,
          countryCode: p.address.country_code,
        },
        starRating: p.ratings?.property?.rating ?? null,
        coordinates: lat && lng ? { lat, lng } : null,
        heroImage: hero,
        images,
        amenities: Object.values(p.amenities ?? {}).map((a) => a.name),
        checkin: {
          beginTime: p.checkin?.begin_time ?? null,
          endTime: p.checkin?.end_time ?? null,
          instructions: p.checkin?.instructions ?? null,
          specialInstructions: p.checkin?.special_instructions ?? null,
          minAge: p.checkin?.min_age ?? null,
        },
        checkout: { time: p.checkout?.time ?? null },
        fees: { mandatory: p.fees?.mandatory ?? null, optional: p.fees?.optional ?? null },
        knowBeforeYouGo: p.policies?.know_before_you_go ?? null,
        description: p.descriptions?.general ?? p.descriptions?.headline ?? null,
        onsiteCurrency: p.onsite_payments?.currency ?? null,
        rooms,
      });
    }
    await recordUnknownFields(logId, notes.names);
    return result;
  }

  async inactiveSince(q: { since: string; next?: string }): Promise<{ propertyIds: string[]; next: string | null }> {
    if (!q.next && !/^\d{4}-\d{2}-\d{2}$/.test(q.since)) throw new Error("inactiveSince: since must be YYYY-MM-DD");
    const { data, logId, next } = await expediaRequest(
      q.next
        ? { method: "GET", path: q.next, context: {}, timeoutMs: CONTENT_TIMEOUT_MS }
        : { method: "GET", path: "/properties/inactive", query: { since: q.since }, context: {}, timeoutMs: CONTENT_TIMEOUT_MS },
    );
    const list = data ?? [];
    if (!Array.isArray(list)) throw new SupplierResponseInvalid("Expedia inactive response is not a list");
    const notes = new ParseNotes();
    const propertyIds: string[] = [];
    list.forEach((raw, i) => {
      const row = check(lenient.inactive, strict.inactive, raw, `[${i}]`, notes);
      if (row && SAFE_ID.test(row.property_id)) propertyIds.push(row.property_id);
    });
    await recordUnknownFields(logId, notes.names);
    return { propertyIds, next };
  }
}
