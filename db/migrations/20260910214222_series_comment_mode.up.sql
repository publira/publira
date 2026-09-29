-- How one series publishes the comments its readers write, when it does not
-- follow the tenant.

-- COLUMN: series_listings comment_mode
-- The same three values tenant_config.comment_mode holds, and NULL for a
-- series that states nothing of its own: the tenant's setting decides for it.
--
-- It is nullable rather than NOT NULL with a default because "follow the
-- tenant" is the answer for nearly every series, and it has to keep following
-- the tenant afterwards — a default copied into every row at the moment this
-- column appeared would freeze each series on whatever the tenant had chosen
-- that day, and the next change to the tenant setting would reach none of
-- them.
--
-- The override stands on its own: a series may turn commenting on for a tenant
-- that has never opened its comment settings and therefore has no tenant_config
-- row at all. Nothing here can state that, so the queries that read a tenant
-- comment setting alongside a comment answer a missing row with the default
-- that column carries.
ALTER TABLE ONLY series_listings
    ADD COLUMN comment_mode text,
    ADD CONSTRAINT series_listings_comment_mode_check CHECK ((comment_mode = ANY (ARRAY['disabled'::text, 'immediate'::text, 'approval_required'::text])));
