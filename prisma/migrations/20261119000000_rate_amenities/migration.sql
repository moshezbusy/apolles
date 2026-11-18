-- Plan 8f: what the rate includes (meal plan, perks), as the supplier named it.
ALTER TABLE "Booking" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "QuoteRoom" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[];
