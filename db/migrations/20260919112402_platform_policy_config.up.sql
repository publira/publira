-- TABLE: platform_policy_config
--
-- The platform's security and abuse-control policy. No value column has a
-- default: a missing row means nothing is saved, and the server answers it
-- with its built-in defaults.
CREATE TABLE platform_policy_config (
    singleton boolean DEFAULT true NOT NULL,
    mfa_required_for_tenant_admin boolean NOT NULL,
    password_verify_limit_per_minute integer NOT NULL,
    password_verify_limit_per_day integer NOT NULL,
    mail_request_limit_per_address_per_hour integer NOT NULL,
    mail_request_limit_per_address_per_day integer NOT NULL,
    mail_request_limit_per_source_per_hour integer NOT NULL,
    mail_request_limit_per_source_per_day integer NOT NULL,
    comment_post_limit_per_minute integer NOT NULL,
    comment_post_limit_per_day integer NOT NULL,
    comment_report_limit_per_minute integer NOT NULL,
    comment_report_limit_per_day integer NOT NULL,
    comment_duplicate_window_minutes integer NOT NULL,
    episode_rating_limit_per_minute integer NOT NULL,
    episode_rating_limit_per_day integer NOT NULL,
    contact_message_limit_per_account_per_hour integer NOT NULL,
    contact_message_limit_per_account_per_day integer NOT NULL,
    contact_message_limit_per_client_per_hour integer NOT NULL,
    contact_message_limit_per_client_per_day integer NOT NULL,
    viewer_preferences_limit_per_minute integer NOT NULL,
    viewer_preferences_limit_per_day integer NOT NULL,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_policy_config_singleton_check CHECK (singleton),
    CONSTRAINT platform_policy_config_revision_positive_check CHECK ((revision > 0)),
    -- A limit of zero refuses everyone, and a longer window allowing less than
    -- a shorter one inside it is a burst rule that can never bind.
    CONSTRAINT platform_policy_config_password_verify_limit_check CHECK (((password_verify_limit_per_minute >= 1) AND (password_verify_limit_per_day >= password_verify_limit_per_minute))),
    CONSTRAINT platform_policy_config_mail_request_address_limit_check CHECK (((mail_request_limit_per_address_per_hour >= 1) AND (mail_request_limit_per_address_per_day >= mail_request_limit_per_address_per_hour))),
    CONSTRAINT platform_policy_config_mail_request_source_limit_check CHECK (((mail_request_limit_per_source_per_hour >= 1) AND (mail_request_limit_per_source_per_day >= mail_request_limit_per_source_per_hour))),
    CONSTRAINT platform_policy_config_comment_post_limit_check CHECK (((comment_post_limit_per_minute >= 1) AND (comment_post_limit_per_day >= comment_post_limit_per_minute))),
    CONSTRAINT platform_policy_config_comment_report_limit_check CHECK (((comment_report_limit_per_minute >= 1) AND (comment_report_limit_per_day >= comment_report_limit_per_minute))),
    CONSTRAINT platform_policy_config_comment_duplicate_window_check CHECK (((comment_duplicate_window_minutes >= 1) AND (comment_duplicate_window_minutes <= 10080))),
    CONSTRAINT platform_policy_config_episode_rating_limit_check CHECK (((episode_rating_limit_per_minute >= 1) AND (episode_rating_limit_per_day >= episode_rating_limit_per_minute))),
    CONSTRAINT platform_policy_config_contact_message_account_limit_check CHECK (((contact_message_limit_per_account_per_hour >= 1) AND (contact_message_limit_per_account_per_day >= contact_message_limit_per_account_per_hour))),
    CONSTRAINT platform_policy_config_contact_message_client_limit_check CHECK (((contact_message_limit_per_client_per_hour >= 1) AND (contact_message_limit_per_client_per_day >= contact_message_limit_per_client_per_hour))),
    CONSTRAINT platform_policy_config_viewer_preferences_limit_check CHECK (((viewer_preferences_limit_per_minute >= 1) AND (viewer_preferences_limit_per_day >= viewer_preferences_limit_per_minute)))
);

-- CONSTRAINT: platform_policy_config platform_policy_config_pkey
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_pkey PRIMARY KEY (singleton);
