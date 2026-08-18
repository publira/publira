-- ListTenants は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListTenantsDesc :many
SELECT *
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
  AND (
    sqlc.narg('cursor_id')::uuid IS NULL
    OR (
      sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
    OR (
      NOT sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
  )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantsAsc :many
SELECT *
FROM tenants
WHERE (sqlc.narg('filter_name')::text = '' OR name ILIKE '%' || sqlc.narg('filter_name')::text || '%')
  AND (sqlc.narg('filter_public_id')::text = '' OR public_id ILIKE '%' || sqlc.narg('filter_public_id')::text || '%')
  AND (sqlc.narg('filter_status')::text = '' OR status = sqlc.narg('filter_status')::text)
  AND (
    sqlc.narg('cursor_id')::uuid IS NULL
    OR (
      sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
    OR (
      NOT sqlc.arg('cursor_inclusive')::boolean
      AND (created_at, id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
    )
  )
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('limit');
-- name: CreateTenant :one
-- プラットフォーム管理者向けテナント作成
-- timezone は列の DEFAULT に任せず、プラットフォーム既定値を明示的に適用する
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, timezone)
VALUES (sqlc.arg('id'), sqlc.arg('public_id'), sqlc.arg('domain'), sqlc.narg('admin_domain'), sqlc.arg('name'), 'active', sqlc.arg('timezone'))
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
-- name: UpdateTenantTimezone :one
-- テナントの表示タイムゾーン (IANA 名) を更新する
UPDATE tenants
SET timezone = sqlc.arg('timezone')
WHERE id = sqlc.arg('id')
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
    tt.favicon_image_id,
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

-- name: SetTenantThemeFaviconImage :one
-- The theme row is created on demand: a tenant can upload a favicon before it
-- has ever saved a color, and the colors then keep their column defaults.
INSERT INTO tenant_themes (tenant_id, favicon_image_id, updated_at)
VALUES ($1, $2, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET favicon_image_id = EXCLUDED.favicon_image_id,
    updated_at = NOW()
RETURNING *;

-- name: CreateTenantImage :one
INSERT INTO tenant_images (
        id,
        tenant_id,
        updated_at
    )
VALUES ($1, $2, NOW())
RETURNING *;

-- name: CreateTenantImageVariant :one
INSERT INTO tenant_image_variants (
        id,
        tenant_id,
        tenant_image_id,
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

-- name: DeleteTenantImage :exec
DELETE FROM tenant_images
WHERE id = $1
    AND tenant_id = $2;

-- name: GetTenantImageByIDForTenant :one
SELECT tiv.object_key,
    tiv.content_type
FROM tenant_images ti
JOIN LATERAL (
    SELECT object_key, content_type
    FROM tenant_image_variants
    WHERE tenant_image_id = ti.id
    ORDER BY width DESC
    LIMIT 1
) tiv ON true
WHERE ti.id = $1
    AND ti.tenant_id = $2
LIMIT 1;

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

-- Platform ListTenantAdminInvitations は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListTenantAdminInvitationsDesc :many
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        accepted_at IS NULL
        OR accepted_at >= NOW() - INTERVAL '7 days'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantAdminInvitationsAsc :many
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        accepted_at IS NULL
        OR accepted_at >= NOW() - INTERVAL '7 days'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('limit');
-- name: BumpUserCredentialsVersion :one
UPDATE users
SET credentials_version = credentials_version + 1
WHERE id = $1
RETURNING *;

-- name: BumpPlatformUserCredentialsVersion :one
UPDATE platform_users
SET credentials_version = credentials_version + 1
WHERE id = $1
RETURNING *;

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

-- name: GetPlatformUserByPublicID :one
SELECT *
FROM platform_users
WHERE public_id = $1
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
INSERT INTO tenant_user_roles (id, tenant_id, user_id, role)
VALUES ($1, $2, $3, $4)
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

-- Worker fan-out: every platform user that holds a role is an operator.
-- name: ListPlatformOperatorIDs :many
SELECT DISTINCT pu.id
FROM platform_users pu
    INNER JOIN platform_user_roles pur ON pur.platform_user_id = pu.id
ORDER BY pu.id;

-- Worker fan-out: every user that holds a tenant_user_roles row is a
-- tenant admin for that tenant. DISTINCT so one person with two roles
-- is still one notification.
-- name: ListTenantAdminIDs :many
SELECT DISTINCT tur.user_id
FROM tenant_user_roles tur
WHERE tur.tenant_id = sqlc.arg('tenant_id')::uuid
ORDER BY tur.user_id;

-- Worker fan-out: members are tenant users that do not hold a tenant role.
-- name: ListTenantMemberIDs :many
SELECT u.id
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
    AND NOT EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
ORDER BY u.id;

-- Platform ListOperators は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListPlatformOperatorsDesc :many
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
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pu.created_at DESC, pu.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPlatformOperatorsAsc :many
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
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pu.created_at, pu.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY pu.created_at ASC, pu.id ASC
LIMIT sqlc.arg('limit');

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
-- 公開シリーズ一覧の cursor ページネーションは 2 段構えになっている。
--
-- 1 段目がここに並ぶ 4 本のキーセット走査で、1 ページぶんの id だけを決める。
-- 並び替えキーは (published_at, id) か (title, id)。id は UUIDv7 なので、
-- published_at や title が同着でも一意に決まる。ORDER BY を並び順ごとに
-- 固定した別のクエリに分けてあるのは、CASE で分岐させると索引順に読めなく
-- なり、LIMIT の手前で全件ソートが入るため。それぞれ
-- idx_series_tenant_published_at / idx_series_tenant_title をそのまま辿る。
-- 前ページ方向は、並び順を反転した側のクエリを呼んで呼び出し側で並べ直す。
--
-- 2 段目が ListActiveSeriesByIDs で、決まった id の表示内容だけを組み立てる。
--
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListActiveSeriesIDsByPublishedAtDesc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) <= (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) < (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.published_at DESC,
    s.id DESC
LIMIT sqlc.arg('limit');
-- name: ListActiveSeriesIDsByPublishedAtAsc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) >= (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) > (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.published_at ASC,
    s.id ASC
LIMIT sqlc.arg('limit');
-- name: ListActiveSeriesIDsByTitleAsc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');
-- name: ListActiveSeriesIDsByTitleDesc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');
-- name: ListActiveSeriesByIDs :many
-- 公開中のシリーズの表示内容を取得する (テナントIDで絞り込み)
-- 並び順は付けない。1 段目が決めた id の順に呼び出し側が並べ直す。
SELECT s.id,
    s.public_id,
    s.title,
    sl.synopsis,
    s.published_at,
    s.eye_catch_image_id,
    NULL::timestamp AS eye_catch_image_updated_at,
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
                c.profile_text,
                'icon_image_url',
                CASE
                    WHEN c.icon_image_id IS NOT NULL THEN '/images/creators/' || c.icon_image_id::text
                    ELSE ''
                END,
                'icon_image_file_size_bytes',
                0,
                'icon_image_updated_at',
                COALESCE(ci.updated_at::TEXT, '')
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
            l.name
        )
        ELSE '{}'::json
    END::jsonb AS label_info
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = ANY(sqlc.arg('ids')::uuid [])
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
GROUP BY s.id,
    sl.series_id,
    sl.synopsis,
    l.public_id,
    l.name;
-- 公開著者一覧の cursor ページネーションは 2 段構え。
--
-- 1 段目が ListPublishedAuthorIDsByName* で、公開中シリーズを 1 本以上持つ
-- creator の id だけを決める。並び替えキーは (name, id)。id は UUIDv7 なので
-- 同名でも一意に決まる。
--
-- 名前順は web-host が localeCompare(..., "ja") で並べていたが、ICU の ja
-- collation は環境ごとにロケールが揃っていないと cursor の比較結果が変わり、
-- btree のキーセット走査が破綻する。そのため DB の既定 collation で name を
-- 比較する。ja-x-icu を後から足すなら、その collation でインデックスを張り
-- 直し、cursor の比較も同じ collation に揃える。
--
-- EXISTS の公開判定は ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ここがずれるとシリーズ一覧と著者ページで見える作品が食い違う。
-- ORDER BY を向きごとに固定した別クエリに分けてあるのは、CASE で分岐させる
-- と idx_creators_tenant_name を索引順に読めなくなるため。前ページ方向は
-- 降順のクエリを呼んで呼び出し側で並べ直す。
--
-- 2 段目が ListPublishedAuthorsByIDs で、決まった id の表示内容と公開
-- シリーズ数だけを組み立てる。
-- name: ListPublishedAuthorIDsByNameAsc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) >= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) > (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name ASC,
    c.id ASC
LIMIT sqlc.arg('limit');
-- name: ListPublishedAuthorIDsByNameDesc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) <= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) < (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name DESC,
    c.id DESC
LIMIT sqlc.arg('limit');
-- name: ListPublishedAuthorsByIDs :many
-- 並び順は付けない。1 段目が決めた id の順に呼び出し側が並べ直す。
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = ANY(sqlc.arg('ids')::uuid []);
-- name: GetPublishedAuthorByPublicID :one
-- 公開中シリーズを 1 本以上持つ creator だけを返す。不在と同じく呼び出し側
-- で not_found にするので、非公開の著者の存在は漏れない。
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.public_id = sqlc.arg('public_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
LIMIT 1;
-- name: ListPublishedSeriesIDsByCreatorTitleAsc :many
-- 著者詳細の関連シリーズ。タイトル + id のキーセット走査。公開判定は
-- ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ListActiveSeriesIDsByTitleAsc と同じ形で、creator で絞る。
-- 前ページ方向は ListPublishedSeriesIDsByCreatorTitleDesc を呼んで
-- 呼び出し側で並べ直す。
SELECT s.id
FROM series s
    JOIN series_creators sc ON sc.series_id = s.id
WHERE sc.creator_id = sqlc.arg('creator_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');
-- name: ListPublishedSeriesIDsByCreatorTitleDesc :many
-- ListPublishedSeriesIDsByCreatorTitleAsc の前ページ方向。
SELECT s.id
FROM series s
    JOIN series_creators sc ON sc.series_id = s.id
WHERE sc.creator_id = sqlc.arg('creator_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');
-- name: GetPublishedLabelByPublicID :one
-- テナントに属するレーベルを返す。公開中シリーズが 0 件でも行は返す
-- （レーベル自体に非公開状態は無い）。不在・他テナントは 0 行。
SELECT l.id,
    l.public_id,
    l.name,
    l.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at,
    (
        SELECT COUNT(*)::int4
        FROM series s
        WHERE s.label_id = l.id
            AND s.tenant_id = l.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM labels l
    LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.public_id = sqlc.arg('public_id')
LIMIT 1;
-- name: ListPublishedSeriesIDsByLabelTitleAsc :many
-- レーベル詳細の関連シリーズ。タイトル + id のキーセット走査。公開判定は
-- ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ListActiveSeriesIDsByTitleAsc と同じ形で、label_id で絞る。
-- 前ページ方向は ListPublishedSeriesIDsByLabelTitleDesc を呼んで
-- 呼び出し側で並べ直す。
-- 索引: idx_series_tenant_label_title
SELECT s.id
FROM series s
WHERE s.label_id = sqlc.arg('label_id')::uuid
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');
-- name: ListPublishedSeriesIDsByLabelTitleDesc :many
-- ListPublishedSeriesIDsByLabelTitleAsc の前ページ方向。
SELECT s.id
FROM series s
WHERE s.label_id = sqlc.arg('label_id')::uuid
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');
-- name: ListPublishedSeriesIDsBySearchTitleAsc :many
-- SearchPublishedSeries。タイトルまたはあらすじが query_pattern に
-- ILIKE マッチする公開シリーズをタイトル + id のキーセットで取る。
-- query_pattern は呼び出し側が '%q%' に組み立て、ILIKE の %/_ は
-- ESCAPE '!' でリテラルにする。
-- 索引方針: idx_series_tenant_title がキーセット半を担う。ILIKE '%q%' は
-- btree に乗らないので、テナント + is_published で絞ったうえで LIMIT が
-- 効くうちはシーケンシャルで足りる。件数が増えて遅延が見えたら title と
-- series_listings.synopsis に pg_trgm GIN を足す。
SELECT s.id
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        s.title ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
        OR COALESCE(sl.synopsis, '') ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');
-- name: ListPublishedSeriesIDsBySearchTitleDesc :many
-- ListPublishedSeriesIDsBySearchTitleAsc の前ページ方向。
SELECT s.id
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        s.title ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
        OR COALESCE(sl.synopsis, '') ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');
-- name: CreateEpisodeBase :one
-- エピソードのBaseレコードを作成する
INSERT INTO episodes (
        id,
        series_id,
        public_id,
        title,
        order_index,
        tenant_id
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;
-- name: UpsertEpisodeListing :one
INSERT INTO episode_listings (
        episode_id,
        price,
        reading_period_hours,
        status,
        scheduled_at,
        published_at,
        tenant_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (episode_id) DO
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
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    t.id AS tenant_id,
    t.public_id AS tenant_public_id,
    t.name AS tenant_name,
    t.domain AS tenant_domain
FROM episode_listings el
    JOIN episodes e ON e.id = el.episode_id
    JOIN series s ON s.id = e.series_id
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

-- 並び替えを伴う操作はシリーズ配下のエピソードを全件見る必要があるため、
-- ページングしない一覧として残す。画面の一覧は下のキーセット走査を使う。
-- 並びは ListEpisodes と同じ (order_index, id)。ReorderEpisodes がクライアントの
-- 読み戻しと比較するので、タイブレーカーが違うと競合していないのに拒否する。
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
    e.id ASC;

-- Admin ListEpisodes は (order_index, id) の昇順で表示する。次ページは昇順、
-- 前ページは降順のクエリで idx_episodes_series_order_index を走査し、前ページ
-- だけ handler で表示順へ戻す。order_index は同着があり得るので、UUIDv7 の id
-- をタイブレーカーにして並びを一意に決める。cursor の共通仕様は
-- proto/README.md を参照。
-- name: ListEpisodesBySeriesForTenantAsc :many
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) >= (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) > (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY e.order_index ASC,
    e.id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodesBySeriesForTenantDesc :many
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) <= (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) < (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY e.order_index DESC,
    e.id DESC
LIMIT sqlc.arg('limit');

-- name: LockSeriesByPublicIDForTenant :one
-- Lock the series row so concurrent CreateEpisode and ReorderEpisodes
-- calls serialize. The following read of the current order (or
-- MAX(order_index)) must be a separate statement: READ COMMITTED
-- freezes its snapshot at statement start, so waiting for the lock in
-- the same statement would still see the pre-wait rows.
SELECT id
FROM series
WHERE tenant_id = $1
    AND public_id = $2
FOR UPDATE;

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
    s.eye_catch_image_id,
    NULL::timestamp AS eye_catch_image_updated_at,
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
                    c.profile_text,
                    'icon_image_url',
                    CASE
                        WHEN c.icon_image_id IS NOT NULL THEN '/images/creators/' || c.icon_image_id::text
                        ELSE ''
                    END,
                    'icon_image_file_size_bytes',
                    0,
                    'icon_image_updated_at',
                    COALESCE(ci.updated_at::TEXT, '')
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
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
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

-- name: GetTenantByID :one
SELECT *
FROM tenants
WHERE id = $1
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
SET published_at = sqlc.narg(published_at)::timestamptz,
    is_published = CASE
        WHEN sqlc.narg(published_at)::timestamptz IS NULL THEN false
        ELSE true
    END,
    updated_at = NOW()
WHERE id = $1;
-- Admin ListSeries は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_series_tenant_created_at を
-- 走査し、前ページだけ handler で表示順へ戻す。id は UUIDv7 なので created_at
-- が同着でも並びが一意に決まる。cursor の共通仕様は proto/README.md を参照。
-- name: ListSeriesByTenantDesc :many
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at,
    s.created_at,
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY s.created_at DESC, s.id DESC
LIMIT sqlc.arg('limit');

-- name: ListSeriesByTenantAsc :many
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at,
    s.created_at,
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY s.created_at ASC, s.id ASC
LIMIT sqlc.arg('limit');
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

-- name: GetEpisodeImageAccessByIDForUser :one
SELECT ei.id,
    ei.episode_id,
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
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = s.tenant_id
                AND at.user_id = $3
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (
                    at.expires_at IS NULL
                    OR at.expires_at > NOW()
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

-- ListEndUsers はエンドユーザー（tenant_user_roles 未保持）の一覧を
-- (created_at, id) の降順で表示する。テナントメンバーは意図的に含めない。
-- プラットフォームのユーザー一覧はこの結果が完全な集合であり、クライアントが
-- ListTenantMembers で補完しない。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListEndUsersDesc :many
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at,
    COALESCE(t.public_id, ''::text) AS tenant_public_id,
    COALESCE(t.name, ''::text) AS tenant_name
FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
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
    AND (
        sqlc.narg('tenant_public_id')::text IS NULL
        OR sqlc.narg('tenant_public_id')::text = ''
        OR t.public_id = sqlc.narg('tenant_public_id')::text
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEndUsersAsc :many
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at,
    COALESCE(t.public_id, ''::text) AS tenant_public_id,
    COALESCE(t.name, ''::text) AS tenant_name
FROM users u
    LEFT JOIN tenants t ON t.id = u.tenant_id
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
    AND (
        sqlc.narg('tenant_public_id')::text IS NULL
        OR sqlc.narg('tenant_public_id')::text = ''
        OR t.public_id = sqlc.narg('tenant_public_id')::text
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- Platform ListTenantMembers はテナントに所属する管理・編集ユーザーを
-- (created_at, id) の降順で表示する。admin の ListTenantUsers とは列が違う
-- （こちらはメール・ステータスも返し、検索の絞り込みを持たない）ので別のクエリ。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListTenantMembersDesc :many
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
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantMembersAsc :many
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
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- Admin ListTenantUsers は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- 絞り込みは SQL 側で行う。handler で取得済みの 1 ページ分だけを突き合わせると、
-- その先のページにいる該当ユーザーが検索結果から丸ごと落ちる。
-- name: ListTenantUsersDesc :many
-- テナントに所属する管理・編集ユーザー一覧（次ページ方向）
SELECT u.id AS user_id,
    u.public_id,
    u.name,
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
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('query')::text IS NULL
        OR strpos(lower(u.public_id), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.name), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.narg('query')::text)) > 0
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at DESC, u.id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantUsersAsc :many
-- テナントに所属する管理・編集ユーザー一覧（前ページ方向）
SELECT u.id AS user_id,
    u.public_id,
    u.name,
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
    u.created_at
FROM users u
WHERE u.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    )
    AND (
        sqlc.narg('query')::text IS NULL
        OR strpos(lower(u.public_id), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.name), lower(sqlc.narg('query')::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.narg('query')::text)) > 0
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (u.created_at, u.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY u.created_at ASC, u.id ASC
LIMIT sqlc.arg('limit');

-- Admin ListCreators は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListCreatorsByTenantDesc :many
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
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListCreatorsByTenantAsc :many
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
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at ASC, c.id ASC
LIMIT sqlc.arg('limit');
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

-- Admin ListLabels と公開側 ListPublishedLabels は (created_at, id) の降順で
-- 表示する。並びも列も同じなので 1 組のクエリを両方から使う。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。cursor の共通仕様は proto/README.md を参照。
-- name: ListLabelsByTenantDesc :many
SELECT labels.id,
    labels.tenant_id,
    labels.public_id,
    labels.name,
    labels.created_at,
    labels.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels
LEFT JOIN label_images li ON li.id = labels.eye_catch_image_id
WHERE labels.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY labels.created_at DESC, labels.id DESC
LIMIT sqlc.arg('limit');

-- name: ListLabelsByTenantAsc :many
SELECT labels.id,
    labels.tenant_id,
    labels.public_id,
    labels.name,
    labels.created_at,
    labels.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels
LEFT JOIN label_images li ON li.id = labels.eye_catch_image_id
WHERE labels.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY labels.created_at ASC, labels.id ASC
LIMIT sqlc.arg('limit');
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
    t.name,
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

-- name: CreateAnnouncement :one
-- お知らせを作成
INSERT INTO announcements (
    id,
    tenant_id,
    target_user_id,
    announcement_type,
    title,
    body,
    link_url,
    metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- Admin ListAnnouncements は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_announcements_tenant_created_at を
-- 走査し、前ページだけ handler で表示順へ戻す。ORDER BY をパラメータで分岐させると
-- 索引順に読めないため、走査方向ごとにクエリを分ける。
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListAnnouncementsForTenantDesc :many
-- テナント管理画面向けお知らせ一覧（次ページ方向）
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForTenantAsc :many
-- テナント管理画面向けお知らせ一覧（前ページ方向）
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- 公開サイトの ListAnnouncements は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで索引を走査し、前ページだけ
-- handler で表示順へ戻す。ORDER BY をパラメータで分岐させると索引順に
-- 読めないため、走査方向ごとにクエリを分ける。
-- cursor の共通仕様は proto/README.md を参照。
-- name: ListAnnouncementsForUserDesc :many
-- お知らせ一覧を取得（既読状態付き・次ページ方向）
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForUserAsc :many
-- お知らせ一覧を取得（既読状態付き・前ページ方向）
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- name: GetAnnouncementForUser :one
-- お知らせ 1 件を取得（既読状態付き）。inbox に属する行だけを返す。
-- 他人・他テナントの行は 0 件になり、存在の有無は区別しない。
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.id = sqlc.arg('id')
    AND n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'));

-- name: MarkAnnouncementAsRead :one
-- 指定したお知らせを既読にする（未読時は新規作成、既読済みなら時刻更新）
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $3, NOW()
FROM announcements n
WHERE n.id = $1
    AND n.tenant_id = $2
    AND (n.target_user_id IS NULL OR n.target_user_id = $3)
ON CONFLICT (announcement_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllAnnouncementsAsRead :execrows
-- 指定ユーザーの未読お知らせを一括既読化
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $2, NOW()
FROM announcements n
WHERE n.tenant_id = $1
    AND (n.target_user_id IS NULL OR n.target_user_id = $2)
    AND NOT EXISTS (
        SELECT 1
        FROM announcement_reads nr
        WHERE nr.announcement_id = n.id
            AND nr.user_id = $2
    )
ON CONFLICT (announcement_id, user_id) DO NOTHING;
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

-- name: CreateAccessTicket :one
INSERT INTO access_tickets (
        id,
        tenant_id,
        public_id,
        episode_id,
        user_id,
        expires_at,
        note,
        created_by_user_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at;

-- name: GetAccessTicketByPublicIDForTenant :one
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = $1
    AND at.public_id = $2
LIMIT 1;

-- Admin ListAccessTickets は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_access_tickets_tenant_created_at
-- を走査し、前ページだけ handler で表示順へ戻す。id は UUIDv7 なので created_at
-- が同着でも並びが一意に決まる。cursor の共通仕様は proto/README.md を参照。
-- name: ListAccessTicketsForTenantDesc :many
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('user_id')::uuid IS NULL
        OR at.user_id = sqlc.narg('user_id')::uuid
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR at.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        NOT sqlc.arg('active_only')::bool
        OR (
            at.revoked_at IS NULL
            AND (
                at.expires_at IS NULL
                OR at.expires_at > NOW()
            )
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY at.created_at DESC,
    at.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAccessTicketsForTenantAsc :many
SELECT at.id,
    at.tenant_id,
    at.public_id,
    at.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    at.user_id,
    u.public_id AS user_public_id,
    u.name AS user_name,
    u.email AS user_email,
    at.expires_at,
    at.revoked_at,
    at.note,
    at.created_by_user_id,
    at.created_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN users u ON u.id = at.user_id
WHERE at.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('user_id')::uuid IS NULL
        OR at.user_id = sqlc.narg('user_id')::uuid
    )
    AND (
        sqlc.narg('episode_id')::uuid IS NULL
        OR at.episode_id = sqlc.narg('episode_id')::uuid
    )
    AND (
        NOT sqlc.arg('active_only')::bool
        OR (
            at.revoked_at IS NULL
            AND (
                at.expires_at IS NULL
                OR at.expires_at > NOW()
            )
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (at.created_at, at.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY at.created_at ASC,
    at.id ASC
LIMIT sqlc.arg('limit');

-- name: RevokeAccessTicketByPublicIDForTenant :one
UPDATE access_tickets
SET revoked_at = NOW()
WHERE tenant_id = $1
    AND public_id = $2
    AND revoked_at IS NULL
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at;

-- name: GetNonRevokedAccessTicketForUserEpisode :one
-- Non-revoked ticket for a user+episode pair (may already be expired).
-- Used for idempotent issue under the unique partial index on non-revoked rows.
SELECT id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at
FROM access_tickets
WHERE tenant_id = $1
    AND user_id = $2
    AND episode_id = $3
    AND revoked_at IS NULL
ORDER BY created_at DESC,
    id DESC
LIMIT 1;

-- name: GetActiveAccessTicketForUserEpisode :one
SELECT id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    expires_at,
    revoked_at,
    note,
    created_by_user_id,
    created_at
FROM access_tickets
WHERE tenant_id = $1
    AND user_id = $2
    AND episode_id = $3
    AND revoked_at IS NULL
    AND (
        expires_at IS NULL
        OR expires_at > NOW()
    )
ORDER BY created_at DESC,
    id DESC
LIMIT 1;

-- name: UserHasEpisodeContentAccess :one
-- True when the user may view paid body content for the episode via purchase or active access ticket.
-- Free episodes (price = 0) are evaluated by the caller; this query only covers grants.
SELECT (
        EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = $1
                AND p.user_id = $2
                AND p.episode_id = $3
                AND (
                    p.expires_at IS NULL
                    OR p.expires_at > NOW()
                )
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = $1
                AND at.user_id = $2
                AND at.episode_id = $3
                AND at.revoked_at IS NULL
                AND (
                    at.expires_at IS NULL
                    OR at.expires_at > NOW()
                )
        )
    ) AS has_access;

-- name: GetPurchasableEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    s.public_id AS series_public_id,
    el.price,
    el.reading_period_hours
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE e.public_id = sqlc.arg('public_id')
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
LIMIT 1;

-- name: UserHasValidPurchaseForEpisode :one
SELECT EXISTS (
    SELECT 1
    FROM purchases
    WHERE tenant_id = sqlc.arg('tenant_id')
        AND user_id = sqlc.arg('user_id')
        AND episode_id = sqlc.arg('episode_id')
        AND (expires_at IS NULL OR expires_at > NOW())
) AS has_purchase;

-- name: ListMyPurchasesDesc :many
SELECT p.id,
    p.price_at_purchase,
    p.expires_at,
    p.purchased_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index AS episode_order_index,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    JOIN series s ON s.id = e.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.user_id = sqlc.arg('user_id')
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) <= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) < (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at DESC,
    p.id DESC
LIMIT sqlc.arg('limit');

-- name: ListMyPurchasesAsc :many
SELECT p.id,
    p.price_at_purchase,
    p.expires_at,
    p.purchased_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index AS episode_order_index,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    JOIN series s ON s.id = e.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.user_id = sqlc.arg('user_id')
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) >= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) > (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at ASC,
    p.id ASC
LIMIT sqlc.arg('limit');

-- name: CreatePurchaseFromStripeCheckout :one
-- The advisory lock serializes different Stripe Checkout sessions for the same
-- buyer and episode. Stripe's request idempotency prevents duplicate sessions
-- in the ordinary case; this also keeps an exceptional concurrent pair from
-- producing two entitlements.
WITH locked AS (
    SELECT pg_advisory_xact_lock(
        hashtextextended(
            $2::text || ':' || $3::text || ':' || $4::text,
            0
        )
    )
)
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    expires_at,
    stripe_checkout_session_id
)
SELECT $1, $2, $3, $4, $5, $6, $7
FROM locked
WHERE NOT EXISTS (
    SELECT 1
    FROM purchases
    WHERE tenant_id = $2
        AND user_id = $3
        AND episode_id = $4
        AND (expires_at IS NULL OR expires_at > NOW())
)
ON CONFLICT (stripe_checkout_session_id) DO NOTHING
RETURNING *;
