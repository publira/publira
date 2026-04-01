-- SMTP 設定（Issue #249）
-- platform 既定値
INSERT INTO platform_smtp_config (
    singleton,
    host,
    port,
    username,
    password_encrypted,
    encryption,
    from_address,
    reply_to
)
VALUES (
    TRUE,
    'mailpit',
    1025,
    'mailpit',
    'enc:seed:platform:dummy-ciphertext-v1',
    'none',
    'no-reply@platform.local',
    'support@platform.local'
)
ON CONFLICT (singleton) DO UPDATE
SET host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    encryption = EXCLUDED.encryption,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    updated_at = NOW();

-- tenant 上書き設定（上書きは無効だが値は保持）
INSERT INTO tenant_smtp_config (
    tenant_id,
    smtp_override_enabled,
    host,
    port,
    username,
    password_encrypted,
    encryption,
    from_name,
    from_address,
    reply_to
)
SELECT
    t.id,
    FALSE,
    'mailpit',
    1025,
    'mailpit',
    'enc:seed:tenant:dummy-ciphertext-v1',
    'none',
    'Seed Tenant Mail',
    'no-reply@tenant.local',
    'help@tenant.local'
FROM tenants t
WHERE t.domain = 'localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET smtp_override_enabled = EXCLUDED.smtp_override_enabled,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    encryption = EXCLUDED.encryption,
    from_name = EXCLUDED.from_name,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    updated_at = NOW();

