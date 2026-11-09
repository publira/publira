-- name: GetPromotionCodeByCode :one
-- The code a reader typed, matched without regard to case among the tenant's
-- codes that are not deleted, with what it has been redeemed so far: in all,
-- and by the reader asking. Whether it applies to the episode or the volume
-- about to be bought is answered beside it, one of the two being NULL.
SELECT pc.id,
    pc.code,
    pc.discount_kind,
    pc.discount_value,
    pc.starts_at,
    pc.ends_at,
    pc.max_redemptions,
    pc.max_redemptions_per_reader,
    pc.paused_at,
    (
        SELECT count(*)
        FROM promotion_code_redemptions r
        WHERE r.tenant_id = pc.tenant_id
            AND r.promotion_code_id = pc.id
    )::integer AS redemption_count,
    (
        SELECT count(*)
        FROM promotion_code_redemptions r
        WHERE r.tenant_id = pc.tenant_id
            AND r.promotion_code_id = pc.id
            AND r.user_id = sqlc.arg('user_id')::uuid
    )::integer AS reader_redemption_count,
    promotion_code_applies(
        pc.target_kind,
        pc.target_id,
        sqlc.narg('episode_id')::uuid,
        sqlc.narg('volume_id')::uuid
    )::boolean AS applies
FROM promotion_codes pc
WHERE pc.tenant_id = sqlc.arg('tenant_id')::uuid
    AND upper(pc.code) = upper(sqlc.arg('code')::text)
    AND pc.deleted_at IS NULL;

-- name: LockPromotionCodeRedemptions :exec
-- Serializes, for the rest of the caller's transaction, the purchases one code
-- grants without a payment, so two requests sent at once each see what the
-- other committed before they count the code's redemptions and the reader's
-- holdings. A purchase paid through a provider or a store is not held to it:
-- its redemption is written whenever the payment is confirmed.
SELECT pg_advisory_xact_lock(hashtextextended('promotion-code:' || sqlc.arg('tenant_id')::uuid::text || ':' || sqlc.arg('id')::uuid::text, 0));

-- name: LockReaderPromotionGrants :exec
-- Serializes, for the rest of the caller's transaction, the purchases codes
-- grant one reader without a payment, whichever code each names, so two
-- requests sent at once with two codes that each make the same episode or
-- volume free see what the other committed before they check what the reader
-- holds. Taken before LockPromotionCodeRedemptions, always in that order.
SELECT pg_advisory_xact_lock(hashtextextended('promotion-grant:' || sqlc.arg('tenant_id')::uuid::text || ':' || sqlc.arg('user_id')::uuid::text, 0));

-- name: TenantHasLivePromotionCode :one
-- Whether the tenant holds a code a reader could enter now or later: one
-- neither deleted, paused, nor past its end. A code whose window has not
-- opened yet, or whose limits are spent, still counts, so the storefront
-- offers the input no later than the code starts working.
SELECT EXISTS (
        SELECT 1
        FROM promotion_codes pc
        WHERE pc.tenant_id = sqlc.arg('tenant_id')::uuid
            AND pc.deleted_at IS NULL
            AND pc.paused_at IS NULL
            AND (
                pc.ends_at IS NULL
                OR pc.ends_at > NOW()
            )
    )::boolean AS has_live_code;

-- name: CreatePromotionCodeRedemption :exec
-- Records that a purchase redeemed a code. A purchase redeems once, so the
-- redelivery of the notification that recorded it writes nothing.
INSERT INTO promotion_code_redemptions (
        id,
        tenant_id,
        promotion_code_id,
        user_id,
        purchase_id
    )
VALUES (
        sqlc.arg('id')::uuid,
        sqlc.arg('tenant_id')::uuid,
        sqlc.arg('promotion_code_id')::uuid,
        sqlc.narg('user_id')::uuid,
        sqlc.arg('purchase_id')::uuid
    ) ON CONFLICT (purchase_id) DO NOTHING;

-- name: CreatePurchaseGrantedByPromotionCode :one
-- The purchase of an episode or a volume a code took the whole price off.
-- Nothing is paid, so no provider opens a checkout for it, and it is recorded
-- at once with no provider and no store, at a price of 0 and with the price
-- it would have been sold at as its list_price, which a royalty statement
-- credits it at.
INSERT INTO purchases (
        id,
        tenant_id,
        user_id,
        episode_id,
        volume_id,
        price_at_purchase,
        list_price,
        promotion_code_id,
        expires_at,
        currency,
        kind
    )
VALUES (
        sqlc.arg('id')::uuid,
        sqlc.arg('tenant_id')::uuid,
        sqlc.arg('user_id')::uuid,
        sqlc.narg('episode_id')::uuid,
        sqlc.narg('volume_id')::uuid,
        0,
        sqlc.arg('list_price')::integer,
        sqlc.arg('promotion_code_id')::uuid,
        sqlc.narg('expires_at')::timestamptz,
        sqlc.arg('currency')::text,
        sqlc.arg('kind')::text
    )
RETURNING *;

-- name: PromotionCodeTargetExists :one
-- Whether the label, series, volume, or episode a new code names is one of
-- the tenant's. The catalog is always there.
--
-- A series is read under a key share lock, held until the code is committed:
-- the code names its series by no foreign key, so the lock is what makes a
-- DeleteSeries running at the same time either wait for the code and refuse,
-- or delete the series first and leave nothing here to find.
SELECT CASE sqlc.arg('target_kind')::text
        WHEN 'catalog' THEN TRUE
        WHEN 'label' THEN EXISTS (
            SELECT 1
            FROM labels l
            WHERE l.tenant_id = sqlc.arg('tenant_id')::uuid
                AND l.id = sqlc.narg('target_id')::uuid
        )
        WHEN 'series' THEN EXISTS (
            SELECT 1
            FROM series s
            WHERE s.tenant_id = sqlc.arg('tenant_id')::uuid
                AND s.id = sqlc.narg('target_id')::uuid
            FOR KEY SHARE OF s
        )
        WHEN 'volume' THEN EXISTS (
            SELECT 1
            FROM volumes v
            WHERE v.tenant_id = sqlc.arg('tenant_id')::uuid
                AND v.id = sqlc.narg('target_id')::uuid
        )
        WHEN 'episode' THEN EXISTS (
            SELECT 1
            FROM episodes e
            WHERE e.tenant_id = sqlc.arg('tenant_id')::uuid
                AND e.id = sqlc.narg('target_id')::uuid
        )
        ELSE FALSE
    END::boolean AS target_exists;

-- name: CreatePromotionCode :one
INSERT INTO promotion_codes (
        id,
        tenant_id,
        code,
        discount_kind,
        discount_value,
        target_kind,
        target_id,
        starts_at,
        ends_at,
        max_redemptions,
        max_redemptions_per_reader,
        created_by_user_id
    )
VALUES (
        sqlc.arg('id')::uuid,
        sqlc.arg('tenant_id')::uuid,
        sqlc.arg('code')::text,
        sqlc.arg('discount_kind')::text,
        sqlc.arg('discount_value')::integer,
        sqlc.arg('target_kind')::text,
        sqlc.narg('target_id')::uuid,
        sqlc.narg('starts_at')::timestamptz,
        sqlc.narg('ends_at')::timestamptz,
        sqlc.narg('max_redemptions')::integer,
        sqlc.narg('max_redemptions_per_reader')::integer,
        sqlc.narg('created_by_user_id')::uuid
    )
RETURNING id;

-- name: LockPromotionCodeForTenant :one
-- Takes a code the tenant has not deleted for a change to it.
SELECT *
FROM promotion_codes
WHERE tenant_id = sqlc.arg('tenant_id')::uuid
    AND id = sqlc.arg('id')::uuid
    AND deleted_at IS NULL
FOR UPDATE;

-- name: UpdatePromotionCodeLimits :exec
-- Changes what a code's tenant may change once it exists: when it works and
-- how often it may be redeemed.
UPDATE promotion_codes
SET starts_at = sqlc.narg('starts_at')::timestamptz,
    ends_at = sqlc.narg('ends_at')::timestamptz,
    max_redemptions = sqlc.narg('max_redemptions')::integer,
    max_redemptions_per_reader = sqlc.narg('max_redemptions_per_reader')::integer,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')::uuid
    AND id = sqlc.arg('id')::uuid;

-- name: SetPromotionCodePaused :exec
-- Pauses a code, keeping the instant it was first paused at, or resumes it.
UPDATE promotion_codes
SET paused_at = CASE
        WHEN sqlc.arg('paused')::boolean THEN COALESCE(paused_at, NOW())
    END,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')::uuid
    AND id = sqlc.arg('id')::uuid;

-- name: DeletePromotionCode :exec
-- Deletes a code softly: the purchases it discounted and its redemptions keep
-- naming it, and its name is free for another code.
UPDATE promotion_codes
SET deleted_at = NOW(),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')::uuid
    AND id = sqlc.arg('id')::uuid
    AND deleted_at IS NULL;

-- name: ListPromotionCodesByIDs :many
-- The codes the tenant has not deleted among ids, as the console shows them:
-- with how many purchases each has discounted and the title of what it
-- applies to, in the tenant's default locale. The order is the caller's to
-- restore.
SELECT pc.*,
    (
        SELECT count(*)
        FROM promotion_code_redemptions r
        WHERE r.tenant_id = pc.tenant_id
            AND r.promotion_code_id = pc.id
    )::integer AS redemption_count,
    COALESCE(l.name, str.title, v.title, et.title, '')::text AS target_title
FROM promotion_codes pc
    LEFT JOIN labels l ON pc.target_kind = 'label'
    AND l.tenant_id = pc.tenant_id
    AND l.id = pc.target_id
    LEFT JOIN series s ON pc.target_kind = 'series'
    AND s.tenant_id = pc.tenant_id
    AND s.id = pc.target_id
    LEFT JOIN LATERAL series_translation_for(s.id, '') str ON TRUE
    LEFT JOIN volumes v ON pc.target_kind = 'volume'
    AND v.tenant_id = pc.tenant_id
    AND v.id = pc.target_id
    LEFT JOIN episodes e ON pc.target_kind = 'episode'
    AND e.tenant_id = pc.tenant_id
    AND e.id = pc.target_id
    LEFT JOIN LATERAL episode_translation_for(e.id, '') et ON TRUE
WHERE pc.tenant_id = sqlc.arg('tenant_id')::uuid
    AND pc.id = ANY(sqlc.arg('ids')::uuid [])
    AND pc.deleted_at IS NULL;

-- name: ListPromotionCodeIDsDesc :many
-- The keyset of ListPromotionCodes, newest first, over the codes not deleted.
SELECT pc.id,
    pc.created_at
FROM promotion_codes pc
WHERE pc.tenant_id = sqlc.arg('tenant_id')::uuid
    AND pc.deleted_at IS NULL
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pc.created_at, pc.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pc.created_at, pc.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY pc.created_at DESC,
    pc.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPromotionCodeIDsAsc :many
-- ListPromotionCodeIDsDesc read backwards, for the page before a token.
SELECT pc.id,
    pc.created_at
FROM promotion_codes pc
WHERE pc.tenant_id = sqlc.arg('tenant_id')::uuid
    AND pc.deleted_at IS NULL
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (pc.created_at, pc.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (pc.created_at, pc.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY pc.created_at ASC,
    pc.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPromotionCodeRedemptionsDesc :many
-- The purchases one code discounted, newest first, with the reader who made
-- each, what was bought, and what it was sold at.
SELECT r.id,
    r.redeemed_at,
    r.user_id,
    u.public_id AS user_public_id,
    u.email AS user_email,
    p.id AS purchase_id,
    p.price_at_purchase,
    purchase_royalty_basis(p.list_price, p.price_at_purchase)::integer AS list_price,
    p.currency,
    p.kind,
    p.episode_id,
    p.volume_id,
    COALESCE(et.title, v.title, '')::text AS item_title
FROM promotion_code_redemptions r
    JOIN purchases p ON p.tenant_id = r.tenant_id
    AND p.id = r.purchase_id
    LEFT JOIN users u ON u.tenant_id = r.tenant_id
    AND u.id = r.user_id
    LEFT JOIN LATERAL episode_translation_for(p.episode_id, '') et ON p.episode_id IS NOT NULL
    LEFT JOIN volumes v ON v.tenant_id = p.tenant_id
    AND v.id = p.volume_id
WHERE r.tenant_id = sqlc.arg('tenant_id')::uuid
    AND r.promotion_code_id = sqlc.arg('promotion_code_id')::uuid
    AND (
        sqlc.narg('cursor_redeemed_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.redeemed_at, r.id) <= (
                sqlc.narg('cursor_redeemed_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.redeemed_at, r.id) < (
                sqlc.narg('cursor_redeemed_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY r.redeemed_at DESC,
    r.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPromotionCodeRedemptionsAsc :many
-- ListPromotionCodeRedemptionsDesc read backwards, for the page before a
-- token.
SELECT r.id,
    r.redeemed_at,
    r.user_id,
    u.public_id AS user_public_id,
    u.email AS user_email,
    p.id AS purchase_id,
    p.price_at_purchase,
    purchase_royalty_basis(p.list_price, p.price_at_purchase)::integer AS list_price,
    p.currency,
    p.kind,
    p.episode_id,
    p.volume_id,
    COALESCE(et.title, v.title, '')::text AS item_title
FROM promotion_code_redemptions r
    JOIN purchases p ON p.tenant_id = r.tenant_id
    AND p.id = r.purchase_id
    LEFT JOIN users u ON u.tenant_id = r.tenant_id
    AND u.id = r.user_id
    LEFT JOIN LATERAL episode_translation_for(p.episode_id, '') et ON p.episode_id IS NOT NULL
    LEFT JOIN volumes v ON v.tenant_id = p.tenant_id
    AND v.id = p.volume_id
WHERE r.tenant_id = sqlc.arg('tenant_id')::uuid
    AND r.promotion_code_id = sqlc.arg('promotion_code_id')::uuid
    AND (
        sqlc.narg('cursor_redeemed_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.redeemed_at, r.id) >= (
                sqlc.narg('cursor_redeemed_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.redeemed_at, r.id) > (
                sqlc.narg('cursor_redeemed_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY r.redeemed_at ASC,
    r.id ASC
LIMIT sqlc.arg('limit');
