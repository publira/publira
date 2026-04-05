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
SELECT
    t.id AS tenant_id,
    COALESCE(tt.background_color, '#f6f2e9') AS background_color,
    COALESCE(tt.foreground_color, '#1e2b38') AS foreground_color,
    COALESCE(tt.surface_color, '#fbf8f2') AS surface_color,
    COALESCE(tt.surface_foreground_color, '#1e2b38') AS surface_foreground_color,
    COALESCE(tt.card_color, '#fffdf8') AS card_color,
    COALESCE(tt.card_foreground_color, '#1e2b38') AS card_foreground_color,
    COALESCE(tt.popover_color, '#fffdf8') AS popover_color,
    COALESCE(tt.popover_foreground_color, '#1e2b38') AS popover_foreground_color,
    COALESCE(tt.primary_color, '#0f7c82') AS primary_color,
    COALESCE(tt.primary_foreground_color, '#f4fbfb') AS primary_foreground_color,
    COALESCE(tt.secondary_color, '#d96f4a') AS secondary_color,
    COALESCE(tt.secondary_foreground_color, '#fff6f1') AS secondary_foreground_color,
    COALESCE(tt.accent_color, '#7aae90') AS accent_color,
    COALESCE(tt.accent_foreground_color, '#0f2a1f') AS accent_foreground_color,
    COALESCE(tt.muted_color, '#e9e1d3') AS muted_color,
    COALESCE(tt.muted_foreground_color, '#5c6773') AS muted_foreground_color,
    COALESCE(tt.border_color, '#d7ccba') AS border_color,
    COALESCE(tt.input_color, '#e3d8c7') AS input_color,
    COALESCE(tt.ring_color, '#2d8d93') AS ring_color,
    COALESCE(tt.success_color, '#2f8f5b') AS success_color,
    COALESCE(tt.success_foreground_color, '#f3fcf7') AS success_foreground_color,
    COALESCE(tt.warning_color, '#c4872a') AS warning_color,
    COALESCE(tt.warning_foreground_color, '#fff8ea') AS warning_foreground_color,
    COALESCE(tt.destructive_color, '#b54444') AS destructive_color,
    COALESCE(tt.destructive_foreground_color, '#fff4f4') AS destructive_foreground_color,
    COALESCE(tt.info_color, '#3c78c2') AS info_color,
    COALESCE(tt.info_foreground_color, '#f3f8ff') AS info_foreground_color,
    tt.logo_url,
    COALESCE(tt.updated_at, NOW()) AS updated_at
FROM tenants t
LEFT JOIN tenant_themes tt ON tt.tenant_id = t.id
WHERE t.id = $1;
-- name: UpsertTenantTheme :one
INSERT INTO tenant_themes (
        tenant_id,
        background_color,
        foreground_color,
        surface_color,
        surface_foreground_color,
        card_color,
        card_foreground_color,
        popover_color,
        popover_foreground_color,
        primary_color,
        primary_foreground_color,
        secondary_color,
        secondary_foreground_color,
        accent_color,
        accent_foreground_color,
        muted_color,
        muted_foreground_color,
        border_color,
        input_color,
        ring_color,
        success_color,
        success_foreground_color,
        warning_color,
        warning_foreground_color,
        destructive_color,
        destructive_foreground_color,
        info_color,
        info_foreground_color,
        logo_url,
        updated_at
    )
VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        $29,
        NOW()
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET background_color = EXCLUDED.background_color,
    foreground_color = EXCLUDED.foreground_color,
    surface_color = EXCLUDED.surface_color,
    surface_foreground_color = EXCLUDED.surface_foreground_color,
    card_color = EXCLUDED.card_color,
    card_foreground_color = EXCLUDED.card_foreground_color,
    popover_color = EXCLUDED.popover_color,
    popover_foreground_color = EXCLUDED.popover_foreground_color,
    primary_color = EXCLUDED.primary_color,
    primary_foreground_color = EXCLUDED.primary_foreground_color,
    secondary_color = EXCLUDED.secondary_color,
    secondary_foreground_color = EXCLUDED.secondary_foreground_color,
    accent_color = EXCLUDED.accent_color,
    accent_foreground_color = EXCLUDED.accent_foreground_color,
    muted_color = EXCLUDED.muted_color,
    muted_foreground_color = EXCLUDED.muted_foreground_color,
    border_color = EXCLUDED.border_color,
    input_color = EXCLUDED.input_color,
    ring_color = EXCLUDED.ring_color,
    success_color = EXCLUDED.success_color,
    success_foreground_color = EXCLUDED.success_foreground_color,
    warning_color = EXCLUDED.warning_color,
    warning_foreground_color = EXCLUDED.warning_foreground_color,
    destructive_color = EXCLUDED.destructive_color,
    destructive_foreground_color = EXCLUDED.destructive_foreground_color,
    info_color = EXCLUDED.info_color,
    info_foreground_color = EXCLUDED.info_foreground_color,
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

-- name: CreateUserEmailChangeToken :one
INSERT INTO user_email_change_tokens (
        id,
        tenant_id,
        user_id,
        current_email,
        new_email,
        current_email_token_hash,
        new_email_token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: CreateUserPasswordResetToken :one
INSERT INTO user_password_reset_tokens (
        id,
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CreatePlatformUserPasswordResetToken :one
INSERT INTO platform_user_password_reset_tokens (
        id,
        platform_user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreatePlatformUserEmailChangeToken :one
INSERT INTO platform_user_email_change_tokens (
        id,
        platform_user_id,
        current_email,
        new_email,
        current_email_token_hash,
        new_email_token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: CreateTenantAdminInvitation :one
INSERT INTO tenant_admin_invitations (
        id,
        tenant_id,
        email,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: DeleteUserEmailChangeTokensByUserID :exec
DELETE FROM user_email_change_tokens
WHERE user_id = $1
    AND completed_at IS NULL;

-- name: DeleteUserPasswordResetTokensByUserID :exec
DELETE FROM user_password_reset_tokens
WHERE user_id = $1
    AND completed_at IS NULL;

-- name: DeletePlatformUserPasswordResetTokensByUserID :exec
DELETE FROM platform_user_password_reset_tokens
WHERE platform_user_id = $1
    AND completed_at IS NULL;

-- name: DeletePlatformUserEmailChangeTokensByUserID :exec
DELETE FROM platform_user_email_change_tokens
WHERE platform_user_id = $1
    AND completed_at IS NULL;

-- name: GetUserEmailVerificationTokenByHashForTenant :one
SELECT *
FROM user_email_verification_tokens
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: GetUserEmailChangeTokenByHashForTenant :one
SELECT *,
    CASE
        WHEN current_email_token_hash = $2 THEN 'current_email'::text
        ELSE 'new_email'::text
    END AS matched_target
FROM user_email_change_tokens
WHERE tenant_id = $1
    AND (
        current_email_token_hash = $2
        OR new_email_token_hash = $2
    )
LIMIT 1;

-- name: GetUserPasswordResetTokenByHashForTenant :one
SELECT *
FROM user_password_reset_tokens
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: GetPlatformUserPasswordResetTokenByHash :one
SELECT *
FROM platform_user_password_reset_tokens
WHERE token_hash = $1
LIMIT 1;

-- name: GetPlatformUserEmailChangeTokenByHash :one
SELECT *,
    CASE
        WHEN current_email_token_hash = $1 THEN 'current_email'::text
        ELSE 'new_email'::text
    END AS matched_target
FROM platform_user_email_change_tokens
WHERE current_email_token_hash = $1
    OR new_email_token_hash = $1
LIMIT 1;

-- name: GetTenantAdminInvitationByTenantAndEmail :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND email = $2
LIMIT 1;

-- name: GetTenantAdminInvitationByIDForTenant :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND id = $2
LIMIT 1;

-- name: GetTenantAdminInvitationByHashForTenant :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: MarkUserEmailVerificationTokenUsed :exec
UPDATE user_email_verification_tokens
SET used_at = NOW()
WHERE id = $1
    AND used_at IS NULL;

-- name: MarkUserEmailChangeCurrentEmailConfirmed :exec
UPDATE user_email_change_tokens
SET current_email_confirmed_at = COALESCE(current_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkUserEmailChangeNewEmailConfirmed :exec
UPDATE user_email_change_tokens
SET new_email_confirmed_at = COALESCE(new_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkUserEmailChangeCompleted :exec
UPDATE user_email_change_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: MarkUserPasswordResetTokenCompleted :exec
UPDATE user_password_reset_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserPasswordResetTokenCompleted :exec
UPDATE platform_user_password_reset_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeCurrentEmailConfirmed :exec
UPDATE platform_user_email_change_tokens
SET current_email_confirmed_at = COALESCE(current_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeNewEmailConfirmed :exec
UPDATE platform_user_email_change_tokens
SET new_email_confirmed_at = COALESCE(new_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeCompleted :exec
UPDATE platform_user_email_change_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: UpdateTenantAdminInvitationForResend :one
UPDATE tenant_admin_invitations
SET token_hash = $3,
    expires_at = $4,
    canceled_at = NULL,
    updated_at = NOW()
WHERE tenant_id = $1
    AND email = $2
RETURNING *;

-- name: CancelTenantAdminInvitation :one
UPDATE tenant_admin_invitations
SET canceled_at = COALESCE(canceled_at, NOW()),
    updated_at = NOW()
WHERE tenant_id = $1
    AND id = $2
RETURNING *;

-- name: MarkTenantAdminInvitationAccepted :one
UPDATE tenant_admin_invitations
SET accepted_at = COALESCE(accepted_at, NOW()),
    updated_at = NOW()
WHERE tenant_id = $1
    AND id = $2
RETURNING *;

-- name: ListTenantAdminInvitations :many
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND (
        accepted_at IS NULL
        OR accepted_at >= NOW() - INTERVAL '7 days'
    )
ORDER BY created_at DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');
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

-- name: UpdatePlatformUserPasswordHashByID :one
UPDATE platform_users
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: UpdatePlatformUserEmailByID :one
UPDATE platform_users
SET email = $2
WHERE id = $1
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
    )::jsonb AS creators,
    CASE
        WHEN l.public_id IS NOT NULL THEN json_build_object(
            'public_id',
            l.public_id,
            'name',
            l.name,
            'eye_catch_image_updated_at',
            li.updated_at::TEXT
        )
        ELSE '{}'::json
    END::jsonb AS label_info
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
WHERE s.tenant_id = $1
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
GROUP BY s.id,
    sl.series_id,
    sl.synopsis,
    l.public_id,
    l.name,
    li.updated_at
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
-- name: ListEpisodesReadyToPublishWithTenantInfo :many
SELECT el.episode_id,
    t.public_id AS tenant_public_id,
    t.domain AS tenant_domain
FROM episode_listings el
JOIN tenants t ON t.id = el.tenant_id
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
    l.public_id AS label_public_id,
    l.name AS label_name,
    l.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at,
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
    LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
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
SELECT l.id,
    l.tenant_id,
    l.public_id,
    l.name,
    l.created_at,
    l.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels l
LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
WHERE l.tenant_id = $1
    AND l.public_id = $2
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
        tenant_id,
        series_id,
        synopsis,
        reading_period_hours
    )
VALUES (
        $1,
        $2,
        $3,
        $4
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
    s.published_at,
    s.eye_catch_image_id,
    si.updated_at AS eye_catch_image_updated_at,
    COALESCE(siv.file_size_bytes, 0)::bigint AS eye_catch_image_file_size_bytes
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_images si ON si.id = s.eye_catch_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM series_image_variants
        WHERE series_image_id = si.id
        ORDER BY width DESC
        LIMIT 1
    ) siv ON true
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
    s.published_at,
    s.eye_catch_image_id,
    si.updated_at AS eye_catch_image_updated_at,
    COALESCE(siv.file_size_bytes, 0)::bigint AS eye_catch_image_file_size_bytes
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_images si ON si.id = s.eye_catch_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM series_image_variants
        WHERE series_image_id = si.id
        ORDER BY width DESC
        LIMIT 1
    ) siv ON true
WHERE s.tenant_id = $1
    AND s.public_id = $2
LIMIT 1;
-- name: CreateSeriesImage :one
INSERT INTO series_images (
        id,
        tenant_id,
        series_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateSeriesImageVariant :one
INSERT INTO series_image_variants (
        id,
        tenant_id,
        series_image_id,
        variant_type,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetSeriesImageVariantByTypeAndWidthForTenant :one
SELECT siv.object_key,
    siv.content_type
FROM series_image_variants siv
JOIN series_images si ON si.id = siv.series_image_id
WHERE siv.series_image_id = $1
    AND si.tenant_id = $2
    AND siv.variant_type = $3
    AND siv.width = $4
LIMIT 1;

-- name: ListSeriesImageVariantsByImageIDs :many
SELECT series_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM series_image_variants
WHERE series_image_id = ANY(@image_ids::uuid[])
ORDER BY series_image_id,
    variant_type,
    width;

-- name: UpdateSeriesEyeCatchImageID :exec
UPDATE series
SET eye_catch_image_id = $2,
    updated_at = NOW()
WHERE id = $1;

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
    tenant_id,
        series_id,
        creator_id,
        role,
        display_order
    )
VALUES ($1, $2, $3, $4, $5);
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
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
VALUES ($1, $2, $3, $4)
RETURNING *;
-- name: CreateEpisodeImageVariant :one
INSERT INTO episode_image_variants (
    id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;
-- name: ListEpisodeImagesByEpisodeID :many
SELECT
    ei.id,
    ei.tenant_id,
    ei.episode_id,
    ei.display_order,
    ei.created_at,
    eiv.content_type,
    eiv.file_size_bytes,
    eiv.width,
    eiv.height
FROM episode_images ei
JOIN LATERAL (
    SELECT content_type, file_size_bytes, width, height
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
WHERE ei.episode_id = $1
ORDER BY ei.display_order ASC,
    ei.created_at ASC;

-- name: ListEpisodeImagesByEpisodePublicIDForTenant :many
SELECT
    ei.id,
    ei.tenant_id,
    ei.episode_id,
    ei.display_order,
    ei.created_at,
    eiv.content_type,
    eiv.file_size_bytes,
    eiv.width,
    eiv.height
FROM episode_images ei
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
JOIN LATERAL (
    SELECT content_type, file_size_bytes, width, height
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
WHERE s.tenant_id = $1
    AND e.public_id = $2
ORDER BY ei.display_order ASC,
    ei.created_at ASC;

-- name: GetEpisodeImageAccessByIDForSession :one
SELECT ei.id,
    eiv.object_key,
    eiv.content_type,
    (
        s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    ) AS is_published,
    (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = s.tenant_id
                AND p.user_id = $3
                AND p.episode_id = e.id
                AND (
                    p.expires_at IS NULL
                    OR p.expires_at > NOW()
                )
        )
    ) AS has_access
FROM episode_images ei
JOIN LATERAL (
    SELECT object_key, content_type
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE ei.id = $1
    AND s.tenant_id = $2
LIMIT 1;

-- name: GetEpisodeImagePublicAccessByIDForTenant :one
SELECT ei.id,
    eiv.object_key,
    eiv.content_type,
    (
        s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    ) AS is_published,
    (el.price = 0) AS has_public_access
FROM episode_images ei
JOIN LATERAL (
    SELECT object_key, content_type
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE ei.id = $1
    AND s.tenant_id = $2
LIMIT 1;

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
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = $1
ORDER BY c.created_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateCreator :one
INSERT INTO creators (
        id,
        tenant_id,
        public_id,
        name,
        profile_text,
        icon_image_id
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateCreatorImage :one
INSERT INTO creator_images (
        id,
        tenant_id,
        creator_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateCreatorImageVariant :one
INSERT INTO creator_image_variants (
        id,
        tenant_id,
        creator_image_id,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetCreatorByPublicIDForTenant :one
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = $1
    AND c.public_id = $2
LIMIT 1;
-- name: UpdateCreator :exec
UPDATE creators
SET name = $2,
    profile_text = $3,
    icon_image_id = $4
WHERE id = $1;

-- name: GetCreatorImageByIDForTenant :one
SELECT civ.object_key,
    civ.content_type
FROM creator_images ci
JOIN LATERAL (
    SELECT object_key, content_type
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE ci.id = $1
    AND ci.tenant_id = $2
LIMIT 1;

-- name: CreateLabelImage :one
INSERT INTO label_images (
        id,
        tenant_id,
        label_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateLabelImageVariant :one
INSERT INTO label_image_variants (
        id,
        tenant_id,
        label_image_id,
        variant_type,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetLabelImageVariantByTypeAndWidthForTenant :one
SELECT liv.object_key,
    liv.content_type
FROM label_image_variants liv
JOIN label_images li ON li.id = liv.label_image_id
WHERE liv.label_image_id = $1
    AND li.tenant_id = $2
    AND liv.variant_type = $3
    AND liv.width = $4
LIMIT 1;

-- name: ListLabelImageVariantsByImageIDs :many
SELECT label_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM label_image_variants
WHERE label_image_id = ANY(@image_ids::uuid[])
ORDER BY label_image_id,
    variant_type,
    width;

-- name: ListLabelsByTenant :many
SELECT labels.id,
    labels.tenant_id,
    labels.public_id,
    labels.name,
    labels.created_at,
    labels.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels
LEFT JOIN label_images li ON li.id = labels.eye_catch_image_id
WHERE labels.tenant_id = $1
ORDER BY labels.created_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateLabel :one
INSERT INTO labels (
        id,
        tenant_id,
        public_id,
        name,
        eye_catch_image_id
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpdateLabel :exec
UPDATE labels
SET name = $2,
    eye_catch_image_id = $3
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

-- name: UpdateUserEmailByID :one
-- ユーザーのメールアドレスをID指定で更新
UPDATE users
SET email = $2
WHERE id = $1
RETURNING *;

-- name: UpdateUserPasswordHashByID :one
-- ユーザーのパスワードハッシュをID指定で更新
UPDATE users
SET password_hash = $2
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

-- name: UpdateUserNameByID :one
-- ユーザーの表示名をID指定で更新
UPDATE users
SET name = $2
WHERE id = $1
RETURNING *;

-- name: GetUserNotificationSettings :one
-- ユーザーの通知設定を取得
SELECT *
FROM user_notification_settings
WHERE user_id = $1
LIMIT 1;

-- name: UpsertUserNotificationSettings :one
-- ユーザーの通知設定を作成または更新
INSERT INTO user_notification_settings (user_id, email_notifications_enabled, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id) DO UPDATE
SET email_notifications_enabled = EXCLUDED.email_notifications_enabled,
    updated_at = NOW()
RETURNING *;

-- name: CreateNotification :one
-- 通知を作成
INSERT INTO notifications (
    id,
    tenant_id,
    target_user_id,
    notification_type,
    title,
    body,
    link_url,
    metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListNotificationsForTenant :many
-- テナント管理画面向け通知一覧を取得
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.notification_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM notifications n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = $1
ORDER BY n.created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListNotificationsForUser :many
-- 通知一覧を取得（既読状態付き）
SELECT
    n.*,
    (nr.notification_id IS NOT NULL) AS is_read,
    nr.read_at
FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id
    AND nr.user_id = $2
WHERE n.tenant_id = $1
    AND (n.target_user_id IS NULL OR n.target_user_id = $2)
ORDER BY n.created_at DESC
LIMIT $3 OFFSET $4;

-- name: MarkNotificationAsRead :one
-- 指定した通知を既読にする（未読時は新規作成、既読済みなら時刻更新）
INSERT INTO notification_reads (notification_id, user_id, read_at)
SELECT n.id, $3, NOW()
FROM notifications n
WHERE n.id = $1
    AND n.tenant_id = $2
    AND (n.target_user_id IS NULL OR n.target_user_id = $3)
ON CONFLICT (notification_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllNotificationsAsRead :execrows
-- 指定ユーザーの未読通知を一括既読化
INSERT INTO notification_reads (notification_id, user_id, read_at)
SELECT n.id, $2, NOW()
FROM notifications n
WHERE n.tenant_id = $1
    AND (n.target_user_id IS NULL OR n.target_user_id = $2)
    AND NOT EXISTS (
        SELECT 1
        FROM notification_reads nr
        WHERE nr.notification_id = n.id
            AND nr.user_id = $2
    );
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
