-- name: ListPublishedPageVersionsByIDsForTenant :many
-- The versions among the given ids that the tenant has published, current or
-- superseded, each with its page. A draft is left out: no reader was shown it.
SELECT id, page_id
FROM page_versions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = ANY(sqlc.arg('ids')::uuid[])
    AND status = 'published';

-- name: CreateUserPageConsent :exec
-- Agreeing to a version the reader has already agreed to keeps the first
-- agreement, so a client that sends its agreement twice is answered the same
-- way both times.
INSERT INTO user_page_consents (tenant_id, user_id, page_version_id)
VALUES (sqlc.arg('tenant_id'), sqlc.arg('user_id'), sqlc.arg('page_version_id'))
ON CONFLICT (user_id, page_version_id) DO NOTHING;

-- name: GetReaderLegalPageAgreements :one
-- Whether the reader has agreed to each page the tenant names as its terms of
-- service and its privacy policy, as far as reader_has_agreed_to_page asks. A
-- role with no page, or whose page is not published, is agreed to: there is
-- nothing a reader could be shown to agree to. No row where the tenant has no
-- config.
SELECT (
        tc.terms_page_id IS NULL
        OR published_page_translation_for(tc.terms_page_id, t.default_locale) IS NULL
        OR reader_has_agreed_to_page(sqlc.arg('user_id'), tc.terms_page_id)
    )::boolean AS terms_agreed,
    (
        tc.privacy_page_id IS NULL
        OR published_page_translation_for(tc.privacy_page_id, t.default_locale) IS NULL
        OR reader_has_agreed_to_page(sqlc.arg('user_id'), tc.privacy_page_id)
    )::boolean AS privacy_agreed
FROM tenant_config tc
    JOIN tenants t ON t.id = tc.tenant_id
WHERE tc.tenant_id = sqlc.arg('tenant_id');
