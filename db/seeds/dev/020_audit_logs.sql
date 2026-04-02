-- 監査ログ（50件）
-- actor: admin@example.com (tenant_admin), member@example.com (member) を交互に使用
-- series / episode / label / creator に対する各種アクション
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
admin_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'admin@example.com'
),
member_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'member@example.com'
),
audit_data(n, action, target_type, actor_role) AS (
    VALUES
        (1,  'series_created',                   'series',  'tenant_admin'),
        (2,  'series_updated',                   'series',  'tenant_admin'),
        (3,  'series_created',                   'series',  'tenant_admin'),
        (4,  'episode_created',                  'episode', 'tenant_admin'),
        (5,  'episode_created',                  'episode', 'tenant_admin'),
        (6,  'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (7,  'series_updated',                   'series',  'member'),
        (8,  'episode_created',                  'episode', 'tenant_admin'),
        (9,  'label_created',                    'label',   'tenant_admin'),
        (10, 'label_updated',                    'label',   'tenant_admin'),
        (11, 'creator_created',                  'creator', 'tenant_admin'),
        (12, 'creator_updated',                  'creator', 'tenant_admin'),
        (13, 'series_created',                   'series',  'tenant_admin'),
        (14, 'episode_created',                  'episode', 'tenant_admin'),
        (15, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (16, 'series_updated',                   'series',  'member'),
        (17, 'series_created',                   'series',  'tenant_admin'),
        (18, 'episode_created',                  'episode', 'tenant_admin'),
        (19, 'label_created',                    'label',   'tenant_admin'),
        (20, 'creator_created',                  'creator', 'tenant_admin'),
        (21, 'series_updated',                   'series',  'tenant_admin'),
        (22, 'episode_created',                  'episode', 'tenant_admin'),
        (23, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (24, 'series_created',                   'series',  'tenant_admin'),
        (25, 'creator_updated',                  'creator', 'member'),
        (26, 'series_updated',                   'series',  'tenant_admin'),
        (27, 'episode_created',                  'episode', 'tenant_admin'),
        (28, 'label_updated',                    'label',   'tenant_admin'),
        (29, 'series_created',                   'series',  'tenant_admin'),
        (30, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (31, 'episode_created',                  'episode', 'tenant_admin'),
        (32, 'series_updated',                   'series',  'member'),
        (33, 'creator_created',                  'creator', 'tenant_admin'),
        (34, 'series_created',                   'series',  'tenant_admin'),
        (35, 'label_created',                    'label',   'tenant_admin'),
        (36, 'episode_created',                  'episode', 'tenant_admin'),
        (37, 'series_updated',                   'series',  'tenant_admin'),
        (38, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (39, 'creator_updated',                  'creator', 'tenant_admin'),
        (40, 'series_created',                   'series',  'tenant_admin'),
        (41, 'episode_created',                  'episode', 'tenant_admin'),
        (42, 'label_updated',                    'label',   'tenant_admin'),
        (43, 'series_updated',                   'series',  'member'),
        (44, 'episode_created',                  'episode', 'tenant_admin'),
        (45, 'series_created',                   'series',  'tenant_admin'),
        (46, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (47, 'creator_created',                  'creator', 'tenant_admin'),
        (48, 'series_updated',                   'series',  'tenant_admin'),
        (49, 'label_created',                    'label',   'tenant_admin'),
        (50, 'episode_created',                  'episode', 'tenant_admin')
)
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    client_ip,
    created_at
)
SELECT
    (
        '018f0e74-'
        || LPAD(TO_HEX(ad.n), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(ad.n), 12, '0')
    )::uuid,
    ts.tenant_id,
    CASE
        WHEN ad.actor_role = 'member' THEN mu.user_id
        ELSE au.user_id
    END,
    ad.actor_role,
    ad.action,
    ad.target_type,
    FORMAT('seed-target-%s', LPAD(ad.n::text, 3, '0')),
    -- n=7,16,25,32,43 は失敗、それ以外は成功
    CASE WHEN ad.n IN (7, 16, 25, 32, 43) THEN 'failure' ELSE 'success' END,
    FORMAT('192.168.1.%s', (ad.n % 10) + 1),
    NOW() - make_interval(
        days  => 30 - ((ad.n - 1) / 2),
        hours => (ad.n * 3) % 24,
        mins  => (ad.n * 7) % 60
    )
FROM audit_data ad
CROSS JOIN tenant_scope ts
CROSS JOIN admin_user au
CROSS JOIN member_user mu
ON CONFLICT (id) DO UPDATE
SET action      = EXCLUDED.action,
    target_type = EXCLUDED.target_type,
    target_id   = EXCLUDED.target_id,
    outcome     = EXCLUDED.outcome,
    client_ip   = EXCLUDED.client_ip,
    created_at  = EXCLUDED.created_at;
