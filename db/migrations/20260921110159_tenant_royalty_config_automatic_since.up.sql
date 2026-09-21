-- The automatic close owes a tenant the months that ended after it chose
-- automatic closing, so an automatic row without that instant has nothing to
-- count from. UpsertTenantRoyaltyConfig always writes the two together; this
-- makes the schema say so too.
ALTER TABLE tenant_royalty_config
    ADD CONSTRAINT tenant_royalty_config_automatic_since_matches_mode
    CHECK ((close_mode = 'automatic') = (automatic_since IS NOT NULL));
