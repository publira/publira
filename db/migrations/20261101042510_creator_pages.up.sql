-- The Author pages: what a reader linked to a creator through creator_accounts
-- is shown of that creator's works, and the tally of the creator's followers
-- those pages read.

-- COLUMN: tenant_config creator_pages_enabled
-- COLUMN: tenant_config creator_pages_show_sales
-- Whether a linked reader may read their creators' pages at all, and whether
-- those pages show sales figures and closed royalty statements. Both start off:
-- a tenant decides what its creators see before they see any of it.
ALTER TABLE tenant_config
    ADD COLUMN creator_pages_enabled boolean DEFAULT false NOT NULL,
    ADD COLUMN creator_pages_show_sales boolean DEFAULT false NOT NULL;

-- TABLE: creator_follower_counts
-- The readers following the creator now. It is a stored tally for the reasons
-- series_follower_counts is: creator_follows is member-isolated, so the
-- connection that reads the number sees none of the follows behind it.
CREATE TABLE creator_follower_counts (
    tenant_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT creator_follower_counts_count_nonneg_check CHECK ((count >= 0))
);

-- CONSTRAINT: creator_follower_counts creator_follower_counts_pkey
ALTER TABLE ONLY creator_follower_counts
    ADD CONSTRAINT creator_follower_counts_pkey PRIMARY KEY (tenant_id, creator_id);

-- FK CONSTRAINT: creator_follower_counts creator_follower_counts_tenant_creator_id_fkey
ALTER TABLE ONLY creator_follower_counts
    ADD CONSTRAINT creator_follower_counts_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: creator_follower_counts
ALTER TABLE creator_follower_counts ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_follower_counts creator_follower_counts_tenant_isolation
CREATE POLICY creator_follower_counts_tenant_isolation ON creator_follower_counts
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: creator_follows_record_change
-- Moves the tally for every follow made and ended. A trigger, as
-- series_follows_record_change is, because deleting an account ends its
-- follows in a cascade no handler runs.
--
-- SECURITY DEFINER because the API roles may not write the tally. Every value
-- comes from the row the trigger fired for, which row-level security already
-- vouched for on creator_follows.
CREATE FUNCTION creator_follows_record_change() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $$
BEGIN
    IF TG_RELID <> 'public.creator_follows'::regclass THEN
        RAISE EXCEPTION 'creator_follows_record_change fires only for public.creator_follows';
    END IF;
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.creator_follower_counts (tenant_id, creator_id, count)
        VALUES (NEW.tenant_id, NEW.creator_id, 1)
        ON CONFLICT (tenant_id, creator_id) DO UPDATE
        SET count = creator_follower_counts.count + 1;
        RETURN NEW;
    END IF;
    UPDATE public.creator_follower_counts
    SET count = count - 1
    WHERE tenant_id = OLD.tenant_id
        AND creator_id = OLD.creator_id;
    RETURN OLD;
END;
$$;

-- TRIGGER: creator_follows creator_follows_record_follow
CREATE TRIGGER creator_follows_record_follow
    AFTER INSERT ON creator_follows
    FOR EACH ROW
    EXECUTE FUNCTION creator_follows_record_change();

-- TRIGGER: creator_follows creator_follows_record_unfollow
CREATE TRIGGER creator_follows_record_unfollow
    AFTER DELETE ON creator_follows
    FOR EACH ROW
    EXECUTE FUNCTION creator_follows_record_change();

-- The tally opens holding the follows already stored. The triggers above were
-- created first, in this same transaction, and hold creator_follows against
-- writes until it commits, so no follow is counted twice or missed between
-- them.
INSERT INTO creator_follower_counts (tenant_id, creator_id, count)
SELECT cf.tenant_id, cf.creator_id, count(*)
FROM creator_follows cf
GROUP BY cf.tenant_id, cf.creator_id;
