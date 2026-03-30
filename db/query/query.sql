-- name: ListTenants :many
-- プラットフォーム管理者向けテナント一覧取得（フィルタ対応）
SELECT *
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
-- name: CreateTenant :one
-- プラットフォーム管理者向けテナント作成
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
VALUES (sqlc.arg('id'), sqlc.arg('public_id'), sqlc.arg('domain'), sqlc.narg('admin_domain'), sqlc.arg('name'), 'active')
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
SET name = sqlc.arg('name'), domain = sqlc.arg('domain'), admin_domain = sqlc.narg('admin_domain')
WHERE public_id = sqlc.arg('public_id')
RETURNING *;
-- name: GetTenantByDomains :one
-- 候補ホスト名の順序を保ったまま最初に一致したテナントを返す
SELECT t.*
FROM unnest(sqlc.arg('domains')::text[]) WITH ORDINALITY AS candidate(domain, ord)
JOIN tenants t ON t.domain = candidate.domain
ORDER BY candidate.ord
LIMIT 1;

-- name: GetAdminTenantByDomains :one
-- 候補ホスト名の順序を保ったまま admin_domain、または admin.{domain} フォールバックで一致したテナントを返す
SELECT t.*
FROM unnest(sqlc.arg('domains')::text[]) WITH ORDINALITY AS candidate(domain, ord)
JOIN tenants t
    ON t.admin_domain = candidate.domain
    OR (
        t.admin_domain IS NULL
        AND candidate.domain = CONCAT('admin.', t.domain)
    )
ORDER BY candidate.ord
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
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CreateUserEmailVerificationToken :one
INSERT INTO user_email_verification_tokens (
        id,
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserEmailVerificationTokenByHashForTenant :one
SELECT *
FROM user_email_verification_tokens
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: MarkUserEmailVerificationTokenUsed :exec
UPDATE user_email_verification_tokens
SET used_at = NOW()
WHERE id = $1
    AND used_at IS NULL;
-- name: GetSessionByTokenHashForTenant :one
SELECT *
FROM sessions
WHERE tenant_id = $1
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
-- name: CreatePlatformSession :one
INSERT INTO platform_sessions (
        id,
        platform_user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4)
RETURNING *;
-- name: GetPlatformSessionByTokenHash :one
SELECT *
FROM platform_sessions
WHERE token_hash = $1
LIMIT 1;
-- name: RevokePlatformSession :exec
UPDATE platform_sessions
SET revoked_at = NOW()
WHERE id = $1;
-- name: TerminatePlatformUserSessions :exec
-- プラットフォームユーザーの全セッションを失効させる
UPDATE platform_sessions
SET revoked_at = NOW()
WHERE platform_user_id = $1
    AND revoked_at IS NULL;
-- name: GetUserByEmailForTenant :one
SELECT *
FROM users
WHERE tenant_id = $1
    AND email = $2
LIMIT 1;

-- name: GetPlatformUserByEmail :one
SELECT *
FROM platform_users
WHERE email = $1
LIMIT 1;
-- name: GetPlatformUserByID :one
SELECT *
FROM platform_users
WHERE id = $1
LIMIT 1;
-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;
-- name: CountPlatformUsers :one
-- プラットフォーム管理ユーザー数を取得する (初期セットアップ判定用)
SELECT COUNT(*)::int
FROM platform_users;
-- name: CreatePlatformUser :one
INSERT INTO platform_users (id, public_id, email, password_hash, name)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpdatePlatformUserStatus :one
-- プラットフォームユーザーのステータスを更新
UPDATE platform_users
SET status = $2
WHERE public_id = $1
RETURNING *;
-- name: CreateUser :one
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreatePlatformUserRole :one
INSERT INTO platform_user_roles (id, platform_user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateTenantUserRole :one
INSERT INTO tenant_user_roles (id, user_id, role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListTenantUserRoles :many
-- テナントユーザーのロール一覧を取得する
SELECT role
FROM tenant_user_roles
WHERE user_id = $1
ORDER BY role;

-- name: ListPlatformUserRoles :many
SELECT role
FROM platform_user_roles
WHERE platform_user_id = $1
ORDER BY role;

-- name: ListPlatformOperators :many
SELECT pu.public_id,
    pu.email,
    pu.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.platform_user_id = pu.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    pu.status,
    pu.created_at
FROM platform_users pu
ORDER BY pu.created_at DESC;

-- name: GetPlatformOperatorByPublicID :one
SELECT pu.id,
    pu.public_id,
    pu.email,
    pu.name,
    COALESCE(
        (
            SELECT pur.role
            FROM platform_user_roles pur
            WHERE pur.platform_user_id = pu.id
            ORDER BY CASE
                    WHEN pur.role = 'platform_super_admin' THEN 3
                    WHEN pur.role = 'platform_operator' THEN 2
                    WHEN pur.role = 'platform_auditor' THEN 1
                    ELSE 0
                END DESC,
                pur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    pu.status,
    pu.created_at
FROM platform_users pu
WHERE pu.public_id = $1
LIMIT 1;

-- name: DeletePlatformUserRolesByPlatformUserID :exec
DELETE FROM platform_user_roles
WHERE platform_user_id = $1;

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
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
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
            pu.public_id::text AS target,
            ''::text AS actor,
            pur.created_at AS occurred_at
        FROM platform_user_roles pur
            JOIN platform_users pu ON pu.id = pur.platform_user_id
        UNION ALL
        SELECT 'end_user_created'::text AS event_type,
            'End User Created'::text AS action,
            u.public_id::text AS target,
            ''::text AS actor,
            u.created_at AS occurred_at
        FROM users u
        WHERE NOT EXISTS (
                SELECT 1
                FROM tenant_user_roles tur
                WHERE tur.user_id = u.id
            )
    ) events
ORDER BY occurred_at DESC
LIMIT $1;
-- name: ListActiveSeries :many
-- 公開中のシリーズ一覧を取得する (テナントIDで絞り込み)
SELECT s.id,
    s.public_id,
    s.title,
    sl.synopsis,
    s.published_at,
    COALESCE(
        json_agg(
            json_build_object(
                'public_id',
                c.public_id,
                'name',
                c.name,
                'role',
                sc.role,
                'profile_text',
                c.profile_text
            )
            ORDER BY sc.display_order ASC
        ) FILTER (
            WHERE c.id IS NOT NULL
        ),
        '[]'
    )::jsonb AS creators
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
WHERE s.tenant_id = $1
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
GROUP BY s.id,
    sl.series_id,
    sl.synopsis
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

-- name: ListEpisodesBySeriesForTenant :many
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
    AND s.public_id = $2
ORDER BY e.order_index ASC,
    e.created_at ASC;

-- name: GetMaxEpisodeOrderIndexBySeriesForTenant :one
SELECT COALESCE(MAX(e.order_index), 0)::int4 AS max_order_index
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE s.tenant_id = $1
    AND s.public_id = $2;

-- name: UpdateEpisodeOrderIndexByPublicIDForTenantAndSeries :exec
UPDATE episodes e
SET order_index = $4
FROM series s
WHERE e.series_id = s.id
    AND s.tenant_id = $1
    AND s.public_id = $2
    AND e.public_id = $3;

-- name: GetSeriesDetail :one
SELECT s.id,
    s.public_id,
    s.title,
    l.name AS label_name,
    sl.synopsis,
    s.is_published,
    s.published_at,
    -- 複数の著者情報をJSON配列として1カラムにまとめる
    COALESCE(
        json_agg(
            json_build_object(
                    'public_id',
                    c.public_id,
                'name',
                c.name,
                    'role',
                    sc.role,
                    'profile_text',
                    c.profile_text
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
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
WHERE s.public_id = $1
    AND s.tenant_id = $2
GROUP BY s.id,
    l.id,
    sl.series_id,
    sl.synopsis;
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
        title
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpdateSeriesBase :exec
UPDATE series
SET title = $2,
    label_id = $3,
    updated_at = NOW()
WHERE id = $1;
-- name: UpsertSeriesListing :one
INSERT INTO series_listings (
        series_id,
        synopsis,
        reading_period_hours
    )
VALUES (
        $1,
        $2,
        $3
    ) ON CONFLICT (series_id) DO
UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours
RETURNING *;
-- name: UpdateSeriesPublication :exec
UPDATE series
SET is_published = $2,
    published_at = CASE
        WHEN $2 THEN COALESCE(published_at, NOW())
        ELSE NULL
    END,
    updated_at = NOW()
WHERE id = $1;
-- name: ListSeriesByTenant :many
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = $1
ORDER BY s.created_at DESC
LIMIT $2 OFFSET $3;
-- name: GetSeriesByPublicIDForTenant :one
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = $1
    AND s.public_id = $2
LIMIT 1;
-- name: ListSeriesCreatorsBySeriesIDs :many
SELECT sc.series_id,
    c.public_id,
    c.name,
    sc.role,
    sc.display_order
FROM series_creators sc
    JOIN creators c ON c.id = sc.creator_id
WHERE sc.series_id = ANY(sqlc.arg('series_ids')::uuid[])
ORDER BY sc.series_id ASC,
    sc.display_order ASC,
    c.created_at ASC;
-- name: ListCreatorsByPublicIDsForTenant :many
SELECT id,
    tenant_id,
    public_id,
    name,
    profile_text,
    created_at
FROM creators
WHERE tenant_id = $1
    AND public_id = ANY(sqlc.arg('public_ids')::varchar[]);
-- name: CreateSeriesCreator :exec
INSERT INTO series_creators (
        series_id,
        creator_id,
        role,
        display_order
    )
VALUES ($1, $2, $3, $4);
-- name: DeleteSeriesCreatorsBySeriesID :exec
DELETE FROM series_creators
WHERE series_id = $1;
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

-- name: GetEpisodeByPublicIDForTenantAndSeries :one
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
    AND s.public_id = $2
    AND e.public_id = $3
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
    el.published_at,
    s.public_id AS series_public_id,
    s.title AS series_title
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

-- name: ListEpisodeImagesByEpisodePublicIDForTenant :many
SELECT ei.*
FROM episode_images ei
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
WHERE s.tenant_id = $1
    AND e.public_id = $2
ORDER BY ei.display_order ASC,
    ei.created_at ASC;

-- name: GetMaxEpisodeImageDisplayOrderByEpisodeID :one
SELECT COALESCE(MAX(display_order), 0)::int4 AS max_display_order
FROM episode_images
WHERE episode_id = $1;

-- name: UpdateEpisodeImageDisplayOrderByIDForEpisode :exec
UPDATE episode_images
SET display_order = $3
WHERE id = $1
    AND episode_id = $2;

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
-- エンドユーザー（tenant_user_roles未保持）の一覧取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at
FROM users u
WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (sqlc.narg('created_after')::timestamptz IS NULL OR u.created_at >= sqlc.narg('created_after')::timestamptz)
    AND (sqlc.narg('created_before')::timestamptz IS NULL OR u.created_at <= sqlc.narg('created_before')::timestamptz)
    AND (
        sqlc.narg('status')::text IS NULL
        OR sqlc.narg('status')::text = ''
        OR u.status = sqlc.narg('status')::text
    )
    AND (sqlc.narg('public_ids')::text[] IS NULL OR u.public_id = ANY(sqlc.narg('public_ids')::text[]))
ORDER BY u.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: ListTenantUsers :many
-- テナントに所属する管理・編集ユーザー一覧を取得する
SELECT u.id AS user_id,
    u.public_id,
    u.name,
    u.email,
    COALESCE(
        (
            SELECT tur.role
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
            ORDER BY CASE
                    WHEN tur.role = 'tenant_admin' THEN 3
                    WHEN tur.role = 'tenant_editor' THEN 2
                    WHEN tur.role = 'tenant_auditor' THEN 1
                    ELSE 0
                END DESC,
                tur.role ASC
            LIMIT 1
        ),
        ''::text
    )::text AS role,
    u.status,
    u.created_at
FROM users u
WHERE u.tenant_id = $1
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
ORDER BY u.created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
-- name: ListCreatorsByTenant :many
SELECT id,
    tenant_id,
    public_id,
    name,
    profile_text,
    created_at
FROM creators
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateCreator :one
INSERT INTO creators (
        id,
        tenant_id,
        public_id,
        name,
        profile_text
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: GetCreatorByPublicIDForTenant :one
SELECT id,
    tenant_id,
    public_id,
    name,
    profile_text,
    created_at
FROM creators
WHERE tenant_id = $1
    AND public_id = $2
LIMIT 1;
-- name: UpdateCreator :exec
UPDATE creators
SET name = $2,
    profile_text = $3
WHERE id = $1;
-- name: ListLabelsByTenant :many
SELECT id,
    tenant_id,
    public_id,
    name,
    created_at
FROM labels
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateLabel :one
INSERT INTO labels (
        id,
        tenant_id,
        public_id,
        name
    )
VALUES ($1, $2, $3, $4)
RETURNING *;
-- name: UpdateLabel :exec
UPDATE labels
SET name = $2
WHERE id = $1;

-- name: DeleteTenantUserRolesByUserID :exec
-- テナントユーザーのロールをすべて削除する
DELETE FROM tenant_user_roles
WHERE user_id = $1;

-- name: GetUserByPublicID :one
-- public_idでテナントユーザーを取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.tenant_id,
    u.created_at
FROM users u
WHERE u.public_id = $1
LIMIT 1;

-- name: GetUserByPublicIDForTenant :one
-- テナントスコープで public_id からユーザーを取得
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.tenant_id,
    u.created_at
FROM users u
WHERE u.tenant_id = $1
    AND u.public_id = $2
LIMIT 1;

-- name: GetTenantByUserID :one
-- ユーザーが所属するテナントを取得
SELECT t.id,
    t.public_id,
    t.created_at
FROM tenants t
    JOIN users u ON u.tenant_id = t.id
WHERE u.id = $1
LIMIT 1;

-- name: UpdateUserStatus :one
-- ユーザーのステータスを更新
UPDATE users
SET status = $2
WHERE public_id = $1
RETURNING *;

-- name: UpdateUserStatusByID :one
-- ユーザーのステータスをID指定で更新
UPDATE users
SET status = $2
WHERE id = $1
RETURNING *;

-- name: UpdateUserEmailVerifiedAtByID :one
-- ユーザーのメール確認日時を更新
UPDATE users
SET email_verified_at = $2
WHERE id = $1
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
-- name: CountPublishedSeriesForTenant :one
-- テナントの公開中シリーズ数を取得する（ダッシュボード用）
SELECT COUNT(*)::int AS published_series_count
FROM series
WHERE tenant_id = $1
    AND is_published = true;

-- name: CountDraftEpisodesForTenant :one
-- テナントの下書きエピソード数を取得する（ダッシュボード用）
SELECT COUNT(*)::int AS draft_episode_count
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status = 'draft';

-- name: CountScheduledEpisodesForTenant :one
-- テナントの予約済みエピソード数を取得する（ダッシュボード用）
SELECT COUNT(*)::int AS scheduled_episode_count
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status = 'scheduled';

-- name: ListRecentEpisodesForDashboard :many
-- ダッシュボードの公開キュー用：直近の下書き・予約済みエピソードを取得する
SELECT
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    el.status,
    el.scheduled_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status IN ('draft', 'scheduled')
ORDER BY
    CASE WHEN el.status = 'scheduled' THEN 0 ELSE 1 END ASC,
    el.scheduled_at ASC NULLS LAST,
    e.created_at DESC
LIMIT $2;

-- name: GetTenantConfigByTenantID :one
SELECT *
FROM tenant_config
WHERE tenant_id = $1
LIMIT 1;

-- name: CreateTenantConfig :one
INSERT INTO tenant_config (tenant_id, copyright_text, site_description, site_tagline)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateTenantConfig :one
UPDATE tenant_config
SET copyright_text = $2, site_description = $3, site_tagline = $4, updated_at = NOW()
WHERE tenant_id = $1
RETURNING *;
