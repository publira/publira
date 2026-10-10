-- Platform operator MFA: the TOTP secret an operator enrolled, the one-time
-- recovery codes that stand in for the authenticator, and the verification
-- challenges already exchanged for a session. They are the platform console's
-- counterparts of user_mfa_totp, user_mfa_recovery_codes and
-- user_mfa_used_challenges, keyed to platform_users instead of a tenant's
-- users. Like every platform_ table they carry no row-level security: an
-- operator belongs to no tenant, and only publira_platform reaches them.

-- TABLE: platform_user_mfa_totp
-- One row per operator, created when enrollment starts. enabled_at stays NULL
-- until the operator proves it can read a code off the authenticator, so an
-- abandoned enrollment never becomes a factor the operator is challenged for.
CREATE TABLE platform_user_mfa_totp (
    platform_user_id uuid NOT NULL,
    secret_encrypted text NOT NULL,
    enabled_at timestamp with time zone,
    -- The last time step a code was accepted for. RFC 6238 section 5.2 asks
    -- that a code be usable once, and the window is wider than one step.
    last_verified_step bigint,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_mfa_totp platform_user_mfa_totp_pkey
ALTER TABLE ONLY platform_user_mfa_totp
    ADD CONSTRAINT platform_user_mfa_totp_pkey PRIMARY KEY (platform_user_id);

-- FK CONSTRAINT: platform_user_mfa_totp platform_user_mfa_totp_platform_user_id_fkey
ALTER TABLE ONLY platform_user_mfa_totp
    ADD CONSTRAINT platform_user_mfa_totp_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- TABLE: platform_user_mfa_recovery_codes
-- Codes are shown once at generation and stored as bcrypt hashes. Used rows
-- are kept rather than deleted: the count of what is left is what the console
-- shows, and a replayed code has to be told from an unknown one.
CREATE TABLE platform_user_mfa_recovery_codes (
    id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_mfa_recovery_codes platform_user_mfa_recovery_codes_pkey
ALTER TABLE ONLY platform_user_mfa_recovery_codes
    ADD CONSTRAINT platform_user_mfa_recovery_codes_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: platform_user_mfa_recovery_codes platform_user_mfa_recovery_codes_platform_user_id_fkey
ALTER TABLE ONLY platform_user_mfa_recovery_codes
    ADD CONSTRAINT platform_user_mfa_recovery_codes_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_user_mfa_recovery_codes_user_created_at
CREATE INDEX idx_platform_user_mfa_recovery_codes_user_created_at ON platform_user_mfa_recovery_codes USING btree (platform_user_id, created_at);

-- TABLE: platform_user_mfa_used_challenges
-- A challenge token is a signed claim rather than a row, so this table is the
-- server-side half that makes one sign-in one session: the jti of a spent
-- verification challenge is recorded here, and the INSERT is what claims it.
-- Rows live no longer than the token they stand for, so expires_at carries
-- the challenge's own expiry and `job purge-mfa-challenges` deletes what is
-- past it.
CREATE TABLE platform_user_mfa_used_challenges (
    jti uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_mfa_used_challenges platform_user_mfa_used_challenges_pkey
ALTER TABLE ONLY platform_user_mfa_used_challenges
    ADD CONSTRAINT platform_user_mfa_used_challenges_pkey PRIMARY KEY (jti);

-- FK CONSTRAINT: platform_user_mfa_used_challenges platform_user_mfa_used_challenges_platform_user_id_fkey
ALTER TABLE ONLY platform_user_mfa_used_challenges
    ADD CONSTRAINT platform_user_mfa_used_challenges_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_user_mfa_used_challenges_expires_at
CREATE INDEX idx_platform_user_mfa_used_challenges_expires_at ON platform_user_mfa_used_challenges USING btree (expires_at);

-- COLUMN: platform_policy_config mfa_required_for_platform_operator
-- Whether an operator with no authenticator is held at enrollment before it
-- gets a session. A saved row starts with it off, which is what it enforced
-- before the column existed. The default is then dropped: no value column of
-- this table has one, so an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN mfa_required_for_platform_operator boolean DEFAULT false NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN mfa_required_for_platform_operator DROP DEFAULT;
