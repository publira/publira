DELETE FROM user_webauthn_ceremonies
WHERE relying_party <> 'admin_console';

ALTER TABLE user_webauthn_ceremonies
    DROP CONSTRAINT IF EXISTS user_webauthn_ceremonies_user_id_check,
    ALTER COLUMN user_id SET NOT NULL,
    DROP CONSTRAINT IF EXISTS user_webauthn_ceremonies_relying_party_check,
    DROP COLUMN IF EXISTS relying_party;

DELETE FROM user_webauthn_credentials
WHERE relying_party <> 'admin_console';

ALTER TABLE user_webauthn_credentials
    DROP CONSTRAINT IF EXISTS user_webauthn_credentials_relying_party_check,
    DROP COLUMN IF EXISTS relying_party;
