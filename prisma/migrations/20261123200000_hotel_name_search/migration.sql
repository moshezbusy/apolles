-- Hotel-name search in the search box. All additive: nothing is dropped or rewritten.

-- The words of the name of every searchable hotel, for "start of the name or of a word" matching
-- (src/server/search/destinations.ts, suggestHotels). The 'simple' configuration keeps every word
-- as written (lower case, no stemming, no stop words).
CREATE INDEX "property_name_words" ON "Property" USING GIN (to_tsvector('simple', "name")) WHERE "active" AND "expediaCollect";

-- A recent search of one hotel chosen by name keeps the hotel. No backfill: older rows are
-- destination searches (null).
ALTER TABLE "RecentSearch" ADD COLUMN     "propertyId" TEXT;
