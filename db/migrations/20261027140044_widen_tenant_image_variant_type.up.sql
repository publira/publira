-- COLUMN: tenant_image_variants.variant_type
-- A brand mark's image variant is named after the mark's kind, and
-- google_play_badge is longer than the 16 characters the column took. Raising
-- a varchar limit is binary coercible, so neither the table nor its unique
-- index is rewritten.
ALTER TABLE ONLY tenant_image_variants
    ALTER COLUMN variant_type TYPE character varying(32);
