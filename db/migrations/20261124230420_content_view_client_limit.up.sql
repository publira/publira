-- COLUMN: platform_policy_config content_view_limit_per_client_per_minute
-- COLUMN: platform_policy_config content_view_limit_per_client_per_day
-- How many page views one client may have ContentViewService.RecordContentView
-- record. A view needs no account, so the allowance is held by the client
-- address rather than by a reader, and it is what bounds the views and the
-- viewers one client can add to a tenant's rankings. These keep their
-- defaults: the previous release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN content_view_limit_per_client_per_minute integer DEFAULT 60 NOT NULL,
    ADD COLUMN content_view_limit_per_client_per_day integer DEFAULT 3000 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_content_view_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_content_view_limit_check CHECK (((content_view_limit_per_client_per_minute >= 1) AND (content_view_limit_per_client_per_day >= content_view_limit_per_client_per_minute)));
