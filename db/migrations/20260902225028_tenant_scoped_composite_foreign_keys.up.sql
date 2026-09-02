-- Make every foreign key that points at a tenant-scoped parent carry tenant_id.
--
-- A single-column reference to users / creators / series / episodes only proves
-- the parent row exists, not that it belongs to the same tenant as the child.
-- The tenant isolation policies check the child's own tenant_id and nothing
-- else, so a session scoped to tenant A could write a row carrying A's
-- tenant_id while pointing at a row owned by tenant B. Each parent already has
-- a UNIQUE (tenant_id, id), so the reference can name both columns and let the
-- database reject the mismatch.
--
-- ON DELETE behaviour is carried over from the constraint being replaced. The
-- one exception is purchases.user_id, which had no constraint to carry.

-- IDENTITY

-- FK CONSTRAINT: user_email_change_tokens user_email_change_tokens_tenant_user_id_fkey
ALTER TABLE ONLY user_email_change_tokens
    DROP CONSTRAINT user_email_change_tokens_user_id_fkey;

ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_tenant_user_id_fkey
ALTER TABLE ONLY user_email_verification_tokens
    DROP CONSTRAINT user_email_verification_tokens_user_id_fkey;

ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_tenant_user_id_fkey
ALTER TABLE ONLY user_password_reset_tokens
    DROP CONSTRAINT user_password_reset_tokens_user_id_fkey;

ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_user_roles tenant_user_roles_tenant_user_id_fkey
ALTER TABLE ONLY tenant_user_roles
    DROP CONSTRAINT tenant_user_roles_user_id_fkey;

ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: audit_logs audit_logs_tenant_actor_user_id_fkey
-- Every writer is an admin API handler acting inside one tenant, so the actor
-- is always a member of the tenant the entry is filed under.
ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_fkey;

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_tenant_actor_user_id_fkey FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id);

-- CATALOG

-- FK CONSTRAINT: creator_images creator_images_tenant_creator_id_fkey
ALTER TABLE ONLY creator_images
    DROP CONSTRAINT creator_images_creator_id_fkey;

ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators series_creators_tenant_creator_id_fkey
ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_creator_id_fkey;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators series_creators_tenant_series_id_fkey
ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_series_id_fkey;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_images series_images_tenant_series_id_fkey
ALTER TABLE ONLY series_images
    DROP CONSTRAINT series_images_series_id_fkey;

ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_listings series_listings_tenant_series_id_fkey
ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_series_id_fkey;

ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episodes episodes_tenant_series_id_fkey
ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_series_id_fkey;

ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id);

-- FK CONSTRAINT: episode_images episode_images_tenant_episode_id_fkey
ALTER TABLE ONLY episode_images
    DROP CONSTRAINT episode_images_episode_id_fkey;

ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_listings episode_listings_tenant_episode_id_fkey
ALTER TABLE ONLY episode_listings
    DROP CONSTRAINT episode_listings_episode_id_fkey;

ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- PAGES

-- FK CONSTRAINT: page_versions page_versions_tenant_author_user_id_fkey
-- author_user_id is nullable; a NULL author leaves the reference unchecked,
-- which is what the single-column constraint did as well.
ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_author_user_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_author_user_id_fkey FOREIGN KEY (tenant_id, author_user_id) REFERENCES users(tenant_id, id);

-- NOTIFICATIONS

-- FK CONSTRAINT: notifications notifications_tenant_user_id_fkey
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_user_id_fkey;

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: notification_reads notification_reads_tenant_user_id_fkey
ALTER TABLE ONLY notification_reads
    DROP CONSTRAINT notification_reads_user_id_fkey;

ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcements announcements_tenant_target_user_id_fkey
-- target_user_id is NULL on tenant-wide announcements, which leaves the
-- reference unchecked just as the single-column constraint did.
ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_target_user_id_fkey;

ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_tenant_target_user_id_fkey FOREIGN KEY (tenant_id, target_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- COMMERCE

-- FK CONSTRAINT: purchases purchases_tenant_episode_id_fkey
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_episode_id_fkey;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id);

-- FK CONSTRAINT: purchases purchases_tenant_user_id_fkey
-- purchases.user_id had no foreign key at all, so rows could name a user that
-- never existed.
--
-- RESTRICT rather than the CASCADE access_tickets uses: a ticket is an
-- entitlement, a purchase is a commerce record. Daily content stats recompute
-- purchase_count straight from this table and replace the whole day, so
-- cascading a buyer's rows away would quietly lower a past day's revenue
-- figures. Deleting a reader who has bought an episode therefore fails until
-- the account deletion path stops needing the buyer row: #1420.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT;
