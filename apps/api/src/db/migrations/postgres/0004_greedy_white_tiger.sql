ALTER TABLE "medication_embodiments" ADD COLUMN "concentration_mg" double precision;--> statement-breakpoint
ALTER TABLE "medication_embodiments" ADD COLUMN "concentration_volume_ml" double precision;
--> statement-breakpoint
-- Backfill: every concentration already on file was entered as a per-mL figure, so it is exactly
-- "x mg per 1 mL". Normalizing existing rows that way (rather than leaving the pair null) means the
-- printed pair is present wherever a concentration is, and no row has to be re-entered by hand.
-- Rows with no concentration at all (tablets, capsules) stay null on all three columns.
UPDATE "medication_embodiments" SET "concentration_mg" = "concentration_mg_per_ml", "concentration_volume_ml" = 1 WHERE "concentration_mg_per_ml" IS NOT NULL;
