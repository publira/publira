-- Restore the single-column foreign keys, in the reverse order of the up.

-- COMMERCE

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_user_id_fkey;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_episode_id_fkey;

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id);

-- NOTIFICATIONS

ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_tenant_target_user_id_fkey;

ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY notification_reads
    DROP CONSTRAINT notification_reads_tenant_user_id_fkey;

ALTER TABLE ONLY notification_reads
    ADD CONSTRAINT notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_tenant_user_id_fkey;

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- PAGES

ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_author_user_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES users(id);

-- CATALOG

ALTER TABLE ONLY episode_listings
    DROP CONSTRAINT episode_listings_tenant_episode_id_fkey;

ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY episode_images
    DROP CONSTRAINT episode_images_tenant_episode_id_fkey;

ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_tenant_series_id_fkey;

ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id);

ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_tenant_series_id_fkey;

ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

ALTER TABLE ONLY series_images
    DROP CONSTRAINT series_images_tenant_series_id_fkey;

ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_tenant_series_id_fkey;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

ALTER TABLE ONLY series_creators
    DROP CONSTRAINT series_creators_tenant_creator_id_fkey;

ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

ALTER TABLE ONLY creator_images
    DROP CONSTRAINT creator_images_tenant_creator_id_fkey;

ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

-- IDENTITY

ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_tenant_actor_user_id_fkey;

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id);

ALTER TABLE ONLY tenant_user_roles
    DROP CONSTRAINT tenant_user_roles_tenant_user_id_fkey;

ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_password_reset_tokens
    DROP CONSTRAINT user_password_reset_tokens_tenant_user_id_fkey;

ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_email_verification_tokens
    DROP CONSTRAINT user_email_verification_tokens_tenant_user_id_fkey;

ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_email_change_tokens
    DROP CONSTRAINT user_email_change_tokens_tenant_user_id_fkey;

ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
