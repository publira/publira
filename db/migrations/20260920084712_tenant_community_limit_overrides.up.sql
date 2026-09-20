-- A tenant may only make the shared community controls stricter. NULL follows
-- the platform policy; the application compares a saved value to the current
-- platform value again when it resolves the effective policy.
CREATE TABLE tenant_community_limit_overrides (
    tenant_id uuid NOT NULL,
    comment_post_limit_per_minute integer,
    comment_post_limit_per_day integer,
    comment_report_limit_per_minute integer,
    comment_report_limit_per_day integer,
    comment_duplicate_window_minutes integer,
    episode_rating_limit_per_minute integer,
    episode_rating_limit_per_day integer,
    contact_message_limit_per_account_per_hour integer,
    contact_message_limit_per_account_per_day integer,
    contact_message_limit_per_client_per_hour integer,
    contact_message_limit_per_client_per_day integer,
    viewer_preferences_limit_per_minute integer,
    viewer_preferences_limit_per_day integer,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_community_limit_overrides_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT tenant_community_limit_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT tenant_community_limit_overrides_revision_positive_check CHECK (revision > 0),
    CONSTRAINT tenant_community_limit_overrides_comment_post_check CHECK ((comment_post_limit_per_minute IS NULL AND comment_post_limit_per_day IS NULL) OR (comment_post_limit_per_minute >= 1 AND comment_post_limit_per_day >= comment_post_limit_per_minute)),
    CONSTRAINT tenant_community_limit_overrides_comment_report_check CHECK ((comment_report_limit_per_minute IS NULL AND comment_report_limit_per_day IS NULL) OR (comment_report_limit_per_minute >= 1 AND comment_report_limit_per_day >= comment_report_limit_per_minute)),
    CONSTRAINT tenant_community_limit_overrides_duplicate_window_check CHECK (comment_duplicate_window_minutes IS NULL OR (comment_duplicate_window_minutes >= 1 AND comment_duplicate_window_minutes <= 10080)),
    CONSTRAINT tenant_community_limit_overrides_episode_rating_check CHECK ((episode_rating_limit_per_minute IS NULL AND episode_rating_limit_per_day IS NULL) OR (episode_rating_limit_per_minute >= 1 AND episode_rating_limit_per_day >= episode_rating_limit_per_minute)),
    CONSTRAINT tenant_community_limit_overrides_contact_account_check CHECK ((contact_message_limit_per_account_per_hour IS NULL AND contact_message_limit_per_account_per_day IS NULL) OR (contact_message_limit_per_account_per_hour >= 1 AND contact_message_limit_per_account_per_day >= contact_message_limit_per_account_per_hour)),
    CONSTRAINT tenant_community_limit_overrides_contact_client_check CHECK ((contact_message_limit_per_client_per_hour IS NULL AND contact_message_limit_per_client_per_day IS NULL) OR (contact_message_limit_per_client_per_hour >= 1 AND contact_message_limit_per_client_per_day >= contact_message_limit_per_client_per_hour)),
    CONSTRAINT tenant_community_limit_overrides_viewer_preferences_check CHECK ((viewer_preferences_limit_per_minute IS NULL AND viewer_preferences_limit_per_day IS NULL) OR (viewer_preferences_limit_per_minute >= 1 AND viewer_preferences_limit_per_day >= viewer_preferences_limit_per_minute))
);

ALTER TABLE tenant_community_limit_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_community_limit_overrides_tenant_isolation ON tenant_community_limit_overrides
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
