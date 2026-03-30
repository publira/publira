DROP INDEX IF EXISTS idx_user_email_verification_tokens_tenant_token;
DROP INDEX IF EXISTS idx_user_email_verification_tokens_user_id;
DROP TABLE IF EXISTS user_email_verification_tokens;

ALTER TABLE users
DROP COLUMN IF EXISTS email_verified_at;
