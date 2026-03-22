-- name: ListTenants :many
-- プラットフォーム管理者向けテナント一覧取得（フィルタ対応）
SELECT id, public_id, domain, name, default_reading_period_hours, created_at, status
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
-- name: CreateTenant :one
-- プラットフォーム管理者向けテナント作成
INSERT INTO tenants (id, public_id, domain, name, status)
VALUES ($1, $2, $3, $4, 'active')
RETURNING *;
-- name: UpdateTenantStatus :one
-- テナントの状態 (active / suspended) を更新する
UPDATE tenants
SET status = $2
WHERE public_id = $1
RETURNING *;
-- name: UpdateTenantInfo :one
-- テナントの名前・ドメインを更新する
UPDATE tenants
SET name = $2, domain = $3
WHERE public_id = $1
RETURNING *;
-- name: GetTenantByDomain :one
-- ホスト名からテナントを特定する (Interceptorで使用)
SELECT *
FROM tenants
WHERE domain = $1
LIMIT 1;
-- name: GetTenantThemeByTenantID :one
SELECT *
FROM tenant_themes
WHERE tenant_id = $1;
-- name: UpsertTenantTheme :one
INSERT INTO tenant_themes (
        tenant_id,
        primary_color,
        secondary_color,
        accent_color,
        logo_url,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET primary_color = EXCLUDED.primary_color,
    secondary_color = EXCLUDED.secondary_color,
    accent_color = EXCLUDED.accent_color,
    logo_url = EXCLUDED.logo_url,
    updated_at = NOW()
RETURNING *;
-- name: CreateSession :one
INSERT INTO sessions (
        id,
    current_tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: GetSessionByTokenHashForTenant :one
SELECT *
FROM sessions
WHERE current_tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: GetSessionByTokenHash :one
SELECT *
FROM sessions
WHERE token_hash = $1
LIMIT 1;
-- name: RevokeSession :exec
UPDATE sessions
SET revoked_at = NOW()
WHERE id = $1;
-- name: GetUserByEmailForTenant :one
SELECT u.*
FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id
    AND tm.tenant_id = $1
    AND tm.status = 'active'
WHERE u.email = $2
LIMIT 1;

-- name: GetUserByEmail :one
SELECT *
FROM users
WHERE email = $1
LIMIT 1;
-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;
-- name: CountPlatformUsers :one
-- プラットフォーム管理ユーザー数を取得する (初期セットアップ判定用)
SELECT COUNT(*)::int
FROM (
        SELECT DISTINCT user_id
        FROM platform_user_roles
    ) platform_users;
-- name: CreateUser :one
INSERT INTO users (id, public_id, email, password_hash, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CreateTenantMembership :one
INSERT INTO tenant_memberships (id, user_id, tenant_id, status)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateTenantMemberRole :one
INSERT INTO tenant_member_roles (id, membership_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreatePlatformUserRole :one
INSERT INTO platform_user_roles (id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListTenantRolesByUserAndTenant :many
SELECT tmr.role
FROM tenant_memberships tm
    JOIN tenant_member_roles tmr ON tmr.membership_id = tm.id
WHERE tm.user_id = $1
    AND tm.tenant_id = $2
    AND tm.status = 'active'
ORDER BY tmr.role;

-- name: ListPlatformUserRoles :many
SELECT role
FROM platform_user_roles
WHERE user_id = $1
ORDER BY role;

-- name: ListPlatformOperators :many
SELECT u.public_id,
    u.email,
    u.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.user_id = u.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'super-admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform-operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.status,
    u.created_at
FROM users u
WHERE EXISTS (
        SELECT 1
        FROM platform_user_roles pur
        WHERE pur.user_id = u.id
    )
ORDER BY u.created_at DESC;

-- name: GetPlatformOperatorByPublicID :one
SELECT u.id,
    u.public_id,
    u.email,
    u.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.user_id = u.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'super-admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform-operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.status,
    u.created_at
FROM users u
WHERE u.public_id = $1
    AND EXISTS (
        SELECT 1
        FROM platform_user_roles pur
        WHERE pur.user_id = u.id
    )
LIMIT 1;

-- name: DeletePlatformUserRolesByUserID :exec
DELETE FROM platform_user_roles
WHERE user_id = $1;

-- name: CountAllTenants :one
SELECT COUNT(*)::int
FROM tenants;

-- name: CountActiveTenants :one
SELECT COUNT(*)::int
FROM tenants
WHERE status = 'active';

-- name: CountSuspendedTenants :one
SELECT COUNT(*)::int
FROM tenants
WHERE status = 'suspended';

-- name: CountPendingEndUsers :one
SELECT COUNT(*)::int
FROM users u
WHERE u.status = 'inactive'
    AND NOT EXISTS (
        SELECT 1
        FROM platform_user_roles pur
        WHERE pur.user_id = u.id
    );

-- name: ListRecentPlatformEvents :many
SELECT event_type,
    action,
    target,
    actor,
    occurred_at
FROM (
        SELECT 'tenant_created'::text AS event_type,
            'Tenant Created'::text AS action,
            t.public_id::text AS target,
            ''::text AS actor,
            t.created_at AS occurred_at
        FROM tenants t
        UNION ALL
        SELECT 'operator_role_granted'::text AS event_type,
            'Operator Role Granted'::text AS action,
            u.public_id::text AS target,
            ''::text AS actor,
            pur.created_at AS occurred_at
        FROM platform_user_roles pur
            JOIN users u ON u.id = pur.user_id
        UNION ALL
        SELECT 'end_user_created'::text AS event_type,
            'End User Created'::text AS action,
            u.public_id::text AS target,
            ''::text AS actor,
            u.created_at AS occurred_at
        FROM users u
        WHERE NOT EXISTS (
                SELECT 1
                FROM platform_user_roles pur
                WHERE pur.user_id = u.id
            )
    ) events
ORDER BY occurred_at DESC
LIMIT $1;
-- name: ListActiveSeries :many
-- 公開中のシリーズ一覧を取得する (テナントIDで絞り込み)
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
ORDER BY s.published_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateEpisodeBase :one
-- エピソードのBaseレコードを作成する
INSERT INTO episodes (
        id,
        series_id,
        public_id,
        title,
        order_index
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpsertEpisodeListing :one
INSERT INTO episode_listings (
        episode_id,
        price,
        reading_period_hours,
        status,
        scheduled_at,
        published_at
    )
VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (episode_id) DO
UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at
RETURNING *;
-- name: ListEpisodesReadyToPublish :many
SELECT el.episode_id
FROM episode_listings el
WHERE el.status = 'scheduled'
    AND el.scheduled_at IS NOT NULL
    AND el.scheduled_at <= NOW();
-- name: MarkEpisodePublished :exec
UPDATE episode_listings
SET status = 'published',
    published_at = NOW()
WHERE episode_id = $1;
-- name: ListPublishedEpisodesBySeries :many
SELECT e.id,
    e.series_id,
    e.public_id,
    e.title,
    e.order_index,
    e.created_at,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON e.id = el.episode_id
WHERE s.tenant_id = $1
    AND e.series_id = $2
    AND el.status = 'published'
ORDER BY e.order_index ASC;
-- name: GetSeriesDetail :one
SELECT s.id,
    s.public_id,
    s.title,
    l.name AS label_name,
    s.synopsis,
    s.is_published,
    s.published_at,
    -- 複数のクリエイター情報をJSON配列として1カラムにまとめる
    COALESCE(
        json_agg(
            json_build_object(
                'name',
                c.name,
                'role',
                sc.role
            )
            ORDER BY sc.display_order ASC
        ) FILTER (
            WHERE c.id IS NOT NULL
        ),
        '[]'
    )::jsonb AS creators,
    COALESCE(
        (
            SELECT json_agg(
                    json_build_object(
                        'public_id',
                        e.public_id,
                        'title',
                        e.title,
                        'order_index',
                        e.order_index,
                        'price',
                        el.price,
                        'reading_period_hours',
                        el.reading_period_hours,
                        'status',
                        el.status,
                        'scheduled_at',
                        el.scheduled_at,
                        'published_at',
                        el.published_at
                    )
                    ORDER BY e.order_index ASC
                )
            FROM episodes e
                JOIN episode_listings el ON el.episode_id = e.id
            WHERE e.series_id = s.id
                AND el.status = 'published'
                AND el.published_at IS NOT NULL
                AND el.published_at <= NOW()
        ),
        '[]'
    )::jsonb AS episodes
FROM series s
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
WHERE s.public_id = $1
    AND s.tenant_id = $2
GROUP BY s.id,
    l.id;
-- name: GetTenantByPublicID :one
SELECT *
FROM tenants
WHERE public_id = $1
LIMIT 1;
-- name: GetLabelByPublicIDForTenant :one
SELECT *
FROM labels
WHERE tenant_id = $1
    AND public_id = $2
LIMIT 1;
-- name: CreateSeriesBase :one
INSERT INTO series (
        id,
        tenant_id,
        label_id,
        public_id,
        title,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, NOW())
RETURNING *;
-- name: UpdateSeriesBase :exec
UPDATE series
SET title = $2,
    label_id = $3,
    updated_at = NOW()
WHERE id = $1;
-- name: UpsertSeriesListing :one
UPDATE series
SET synopsis = $2,
    reading_period_hours = $3,
    is_published = $4,
    published_at = CASE
        WHEN $4 THEN COALESCE(series.published_at, NOW())
        ELSE NULL
    END,
    updated_at = NOW()
WHERE id = $1
RETURNING id AS series_id,
    synopsis,
    reading_period_hours,
    is_published,
    published_at;
-- name: ListSeriesByTenant :many
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.is_published,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
ORDER BY s.created_at DESC
LIMIT $2 OFFSET $3;
-- name: GetSeriesByPublicIDForTenant :one
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.is_published,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
    AND s.public_id = $2
LIMIT 1;
-- name: GetEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND e.public_id = $2
LIMIT 1;
-- name: GetPublishedEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND e.public_id = $2
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
LIMIT 1;
-- name: CreateEpisodeImage :one
INSERT INTO episode_images (
        id,
        tenant_id,
        episode_id,
        storage_provider,
        object_key,
        image_url,
        content_type,
        file_size_bytes,
    display_order,
    width,
    height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;
-- name: ListEpisodeImagesByEpisodeID :many
SELECT *
FROM episode_images
WHERE episode_id = $1
ORDER BY display_order ASC,
    created_at ASC;
-- name: UpdateEpisodePublishScheduleByPublicIDForTenant :exec
UPDATE episode_listings el
SET status = CASE
        WHEN $3 IS NULL THEN 'draft'
        ELSE 'scheduled'
    END,
    scheduled_at = $3,
    published_at = CASE
        WHEN $3 IS NULL THEN NULL
        ELSE el.published_at
    END
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE el.episode_id = e.id
    AND s.tenant_id = $1
    AND e.public_id = $2;

-- name: ListEndUsers :many
-- エンドユーザー（platform_user_roles未保持）の一覧取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at
FROM users u
WHERE NOT EXISTS (
        SELECT 1
        FROM platform_user_roles pur
        WHERE pur.user_id = u.id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM tenant_memberships tm
        WHERE tm.user_id = u.id
    )
    AND (sqlc.narg('created_after')::timestamptz IS NULL OR u.created_at >= sqlc.narg('created_after')::timestamptz)
    AND (sqlc.narg('created_before')::timestamptz IS NULL OR u.created_at <= sqlc.narg('created_before')::timestamptz)
    AND (sqlc.narg('status')::text = '' OR u.status = sqlc.narg('status')::text)
ORDER BY u.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: ListTenantMemberships :many
-- テナントに所属するメンバー一覧を取得する
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    u.email,
    COALESCE(
        (
            SELECT tmr.role
            FROM tenant_member_roles tmr
            WHERE tmr.membership_id = tm.id
            ORDER BY CASE
                    WHEN tmr.role = 'tenant_admin' THEN 3
                    WHEN tmr.role = 'admin' THEN 3
                    WHEN tmr.role = 'tenant_editor' THEN 2
                    WHEN tmr.role = 'editor' THEN 2
                    WHEN tmr.role = 'tenant_auditor' THEN 1
                    WHEN tmr.role = 'auditor' THEN 1
                    ELSE 0
                END DESC,
                tmr.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    tm.status,
    tm.created_at
FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
WHERE tm.tenant_id = $1
ORDER BY tm.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: GetTenantMembershipByUserAndTenant :one
-- ユーザーとテナントIDでメンバーシップを取得する
SELECT tm.id, tm.user_id, tm.tenant_id, tm.status, tm.created_at
FROM tenant_memberships tm
WHERE tm.user_id = $1
    AND tm.tenant_id = $2
LIMIT 1;

-- name: DeleteTenantMembership :exec
DELETE FROM tenant_memberships
WHERE id = $1;

-- name: DeleteTenantMemberRolesByMembershipID :exec
DELETE FROM tenant_member_roles
WHERE membership_id = $1;

-- name: GetUserByPublicID :one
-- public_idでユーザーを取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at
FROM users u
WHERE u.public_id = $1
LIMIT 1;

-- name: GetTenantsByEndUser :many
-- エンドユーザーが所属するテナント一覧を取得
SELECT DISTINCT t.id,
    t.public_id
FROM tenants t
    JOIN tenant_memberships tm ON tm.tenant_id = t.id
WHERE tm.user_id = $1
    AND tm.status = 'active'
ORDER BY t.created_at DESC;

-- name: CountTenantMembershipsByUserID :one
-- ユーザーに紐づくテナントメンバーシップ件数を取得
SELECT COUNT(*)::int
FROM tenant_memberships
WHERE user_id = $1;

-- name: UpdateUserStatus :one
-- ユーザーのステータスを更新
UPDATE users
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: TerminateUserSessions :exec
-- ユーザーの全セッションを失効させる
UPDATE sessions
SET revoked_at = NOW()
WHERE user_id = $1
    AND revoked_at IS NULL;

-- name: DeleteUserByID :exec
-- ユーザーを物理削除（外部キー制約により関連データも削除）
DELETE FROM users
WHERE id = $1;