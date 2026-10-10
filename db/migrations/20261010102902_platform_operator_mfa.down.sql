ALTER TABLE platform_policy_config
    DROP COLUMN mfa_required_for_platform_operator;

DROP TABLE IF EXISTS platform_user_mfa_used_challenges;
DROP TABLE IF EXISTS platform_user_mfa_recovery_codes;
DROP TABLE IF EXISTS platform_user_mfa_totp;
