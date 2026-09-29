-- The VAPID key pair every browser subscription is made against and every Web
-- Push delivery is signed with. The server generates the pair the first time
-- it is asked for one, so a row that exists always holds a complete pair; Web
-- Push is live only once an operator has also saved the subject.
CREATE TABLE platform_webpush_config (
    singleton boolean DEFAULT true NOT NULL,
    -- The uncompressed P-256 point as base64url without padding, which is the
    -- form a browser's applicationServerKey takes.
    vapid_public_key text NOT NULL,
    -- The private scalar, sealed with the secret encryption keys.
    vapid_private_key_encrypted text NOT NULL,
    -- The contact a push service may reach the sender at, a mailto: or https:
    -- URI. NULL until an operator saves one, and that is the whole "not
    -- configured" state.
    subject text,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_webpush_config_singleton_check CHECK (singleton),
    CONSTRAINT platform_webpush_config_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT platform_webpush_config_public_key_not_blank_check CHECK ((btrim(vapid_public_key) <> '')),
    CONSTRAINT platform_webpush_config_private_key_not_blank_check CHECK ((btrim(vapid_private_key_encrypted) <> '')),
    CONSTRAINT platform_webpush_config_subject_not_blank_check CHECK (((subject IS NULL) OR (btrim(subject) <> '')))
);

-- CONSTRAINT: platform_webpush_config platform_webpush_config_pkey
ALTER TABLE ONLY platform_webpush_config
    ADD CONSTRAINT platform_webpush_config_pkey PRIMARY KEY (singleton);
