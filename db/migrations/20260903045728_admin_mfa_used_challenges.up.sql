-- Admin MFA: the verification challenges that have already been spent.
--
-- A challenge token is a signed claim rather than a row, so nothing about it
-- changes when VerifyMfa exchanges it for a session: until it expires, the
-- same token answers a second exchange. This table is the server-side half
-- that makes one login one session — the jti of a spent challenge is recorded
-- here, and the INSERT is what claims it.
--
-- Only verification challenges are recorded. An enrollment challenge is
-- presented twice by design (StartMfaEnrollment, then ConfirmMfaEnrollment)
-- and is already single-use in effect: once it enables the factor, the same
-- token is refused with `mfa is already enabled`.

-- TABLE: user_mfa_used_challenges
-- Rows live no longer than the token they stand for, so expires_at carries
-- the challenge's own expiry and `batch purge-mfa-challenges` deletes what is
-- past it.
CREATE TABLE user_mfa_used_challenges (
    jti uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_mfa_used_challenges user_mfa_used_challenges_pkey
ALTER TABLE ONLY user_mfa_used_challenges
    ADD CONSTRAINT user_mfa_used_challenges_pkey PRIMARY KEY (jti);

-- FK CONSTRAINT: user_mfa_used_challenges user_mfa_used_challenges_tenant_user_id_fkey
ALTER TABLE ONLY user_mfa_used_challenges
    ADD CONSTRAINT user_mfa_used_challenges_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_mfa_used_challenges_expires_at
CREATE INDEX idx_user_mfa_used_challenges_expires_at ON user_mfa_used_challenges USING btree (expires_at);

-- ROW SECURITY: user_mfa_used_challenges
ALTER TABLE user_mfa_used_challenges ENABLE ROW LEVEL SECURITY;

-- POLICY: user_mfa_used_challenges user_mfa_used_challenges_tenant_isolation
CREATE POLICY user_mfa_used_challenges_tenant_isolation ON user_mfa_used_challenges USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
