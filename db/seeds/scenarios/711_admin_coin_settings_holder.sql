-- Scenario: a reader of the coin settings tenant holding coins
--
-- `admin.coin-settings.spec.ts` applies it once the administrator has turned
-- the tenant's coins on, so that turning them off is refused for the reader
-- who holds them. Coins granted before then would fix what one is worth
-- before the administrator has stated it. Applying
-- `710_admin_coin_settings.sql` takes the grant away again.
--   reader   CsetMMBRAAA1 (Coin Keeper), granted 40 coins by staff

INSERT INTO coin_grants (
    id,
    tenant_id,
    user_id,
    source,
    coins,
    remaining_coins,
    expires_at,
    granted_at
)
SELECT
    '018f1720-000c-7000-8000-000000000001'::uuid,
    u.tenant_id,
    u.id,
    'staff',
    40,
    40,
    NOW() + INTERVAL '180 days',
    NOW()
FROM users u
WHERE u.public_id = 'CsetMMBRAAA1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO coin_transactions (id, tenant_id, user_id, kind, coins, grant_id, created_at)
SELECT
    '018f1720-000d-7000-8000-000000000001'::uuid,
    g.tenant_id,
    g.user_id,
    'grant',
    g.coins,
    g.id,
    g.granted_at
FROM coin_grants g
WHERE g.id = '018f1720-000c-7000-8000-000000000001'::uuid
ON CONFLICT (id) DO NOTHING;
