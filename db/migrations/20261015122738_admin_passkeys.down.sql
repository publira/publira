ALTER TABLE user_mfa_totp
    ADD COLUMN failed_attempts integer DEFAULT 0 NOT NULL,
    ADD COLUMN locked_until timestamp with time zone;

UPDATE user_mfa_totp t
SET failed_attempts = l.failed_attempts,
    locked_until = l.locked_until
FROM user_mfa_lockouts l
WHERE l.user_id = t.user_id;

DROP TABLE IF EXISTS user_mfa_lockouts;
DROP TABLE IF EXISTS user_webauthn_ceremonies;
DROP TABLE IF EXISTS user_webauthn_credentials;
