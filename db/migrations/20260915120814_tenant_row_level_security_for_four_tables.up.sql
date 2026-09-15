-- Four tables holding tenant or reader data carried no row-level security, so
-- the isolation every other table in the schema relies on was absent for them
-- while the API roles held SELECT, INSERT, UPDATE and DELETE on all of them.
-- Three of the four also had no tenant_id for a policy to name, and it is
-- backfilled here from the row each one already points at.

-- announcements is a tenant's public notices and already carries tenant_id, so
-- it only wants the isolation its neighbours in this domain have.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- POLICY: announcements announcements_tenant_isolation
CREATE POLICY announcements_tenant_isolation ON announcements USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- announcement_reads is one reader's own state rather than the tenant's, so
-- tenant isolation alone would leave one member of a tenant reading and
-- rewriting another's. It takes the member isolation episode_reads has, and the
-- tenant_id that policy names comes from the user the row already points at.
ALTER TABLE announcement_reads
    ADD COLUMN tenant_id uuid;

UPDATE announcement_reads ar
SET tenant_id = u.tenant_id
FROM users u
WHERE u.id = ar.user_id;

ALTER TABLE announcement_reads
    ALTER COLUMN tenant_id SET NOT NULL;

-- FK CONSTRAINT: announcement_reads announcement_reads_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant. It
-- replaces the single-column FK, which the composite one subsumes.
ALTER TABLE ONLY announcement_reads
    DROP CONSTRAINT announcement_reads_user_id_fkey;

ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: announcement_reads
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

-- POLICY: announcement_reads announcement_reads_member_isolation
CREATE POLICY announcement_reads_member_isolation ON announcement_reads
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- user_notification_settings is whether one reader takes mail, which is that
-- reader's own state for the same reason, and it gets the same treatment.
ALTER TABLE user_notification_settings
    ADD COLUMN tenant_id uuid;

UPDATE user_notification_settings uns
SET tenant_id = u.tenant_id
FROM users u
WHERE u.id = uns.user_id;

ALTER TABLE user_notification_settings
    ALTER COLUMN tenant_id SET NOT NULL;

-- FK CONSTRAINT: user_notification_settings user_notification_settings_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant. It
-- replaces the single-column FK, which the composite one subsumes.
ALTER TABLE ONLY user_notification_settings
    DROP CONSTRAINT user_notification_settings_user_id_fkey;

ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_notification_settings
ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: user_notification_settings user_notification_settings_member_isolation
CREATE POLICY user_notification_settings_member_isolation ON user_notification_settings
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- episode_image_variants holds the stored object keys of a tenant's episode
-- pages. It is decoration on episode_images, which carries both a tenant_id and
-- a policy, so it takes the treatment its siblings series_image_variants and
-- creator_image_variants already have.
ALTER TABLE episode_image_variants
    ADD COLUMN tenant_id uuid;

UPDATE episode_image_variants eiv
SET tenant_id = ei.tenant_id
FROM episode_images ei
WHERE ei.id = eiv.episode_image_id;

ALTER TABLE episode_image_variants
    ALTER COLUMN tenant_id SET NOT NULL;

-- FK CONSTRAINT: episode_image_variants episode_image_variants_tenant_id_fkey
ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episode_image_variants_tenant_id
CREATE INDEX idx_episode_image_variants_tenant_id ON episode_image_variants USING btree (tenant_id);

-- ROW SECURITY: episode_image_variants
ALTER TABLE episode_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_image_variants episode_image_variants_tenant_isolation
CREATE POLICY episode_image_variants_tenant_isolation ON episode_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
