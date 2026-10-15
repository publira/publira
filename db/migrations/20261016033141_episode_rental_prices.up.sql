-- An episode can be sold twice over: as a rental, cheaper and for a period,
-- and as a permanent copy. The permanent copy keeps the columns the only sale
-- used until now, price and reading_period_hours, so every episode already in
-- a catalog is sold as it was; a permanent price with a period is still how a
-- tenant that only lends prices an episode.
--
-- The CHECK constraints are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE locks without scanning any table; the next migration validates
-- them under a lock that lets reads and writes continue.

-- COLUMN: episode_listings rental_price, rental_period_hours
-- The rental, in the minor unit of the tenant currency as price is, and how
-- long it opens the episode. Both are set or neither is: a rental without a
-- period is the permanent copy sold again, and NULL is an episode that is not
-- rented. A rental undercuts the permanent copy, so it needs a priced episode
-- and a price below it.
ALTER TABLE ONLY episode_listings
    ADD COLUMN rental_price integer,
    ADD COLUMN rental_period_hours integer,
    ADD CONSTRAINT episode_listings_rental_check CHECK ((((rental_price IS NULL) = (rental_period_hours IS NULL)) AND ((rental_price IS NULL) OR ((rental_price > 0) AND (rental_price < price) AND (rental_period_hours > 0))))) NOT VALID;

-- COLUMN: series_listings rental_period_hours
-- Where the rental period of each new episode in the series starts, as
-- reading_period_hours is for the permanent copy's. NULL starts them with no
-- default.
ALTER TABLE ONLY series_listings
    ADD COLUMN rental_period_hours integer,
    ADD CONSTRAINT series_listings_rental_period_hours_check CHECK (((rental_period_hours IS NULL) OR (rental_period_hours > 0))) NOT VALID;

-- COLUMN: purchases kind
-- What the reader bought: the rental or the permanent copy. Every purchase
-- recorded before this column was the permanent copy, the only one sold, and
-- so is every purchase a store or staff records, so the default stays.
ALTER TABLE ONLY purchases
    ADD COLUMN kind text DEFAULT 'purchase'::text NOT NULL,
    ADD CONSTRAINT purchases_kind_check CHECK ((kind = ANY (ARRAY['rental'::text, 'purchase'::text]))) NOT VALID;

-- VIEW: episode_content_grants
-- purchase_kind names which of the two a purchase grant is, and is NULL on
-- every other grant: an active rental does not keep the reader from buying the
-- permanent copy, and an active permanent copy keeps them from buying either.
-- It is a column of its own rather than more values of kind, which says how a
-- reader came to hold the episode and is the same for both.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;
