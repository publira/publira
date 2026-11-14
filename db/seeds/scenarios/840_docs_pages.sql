-- Scenario: the unpublished page the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/3-setup/ about pages explains the
-- dialog that deletes a page, which the console offers only while no
-- translation of the page is published, and the development seed publishes
-- every page it writes. One draft page, About us at /about, is added to the
-- moderation tenant, ModrTNNTAAA1, which 150_comment_moderation.sql creates
-- and this file needs first, so the seed tenant's page list keeps the rows
-- its own screenshot shows.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. The page has no
-- version, so the tenant's site never serves it, and the screenshot leaves the
-- dialog unsubmitted. Its translation is deleted with the page, so the file
-- deletes and writes only its own row.

BEGIN;

DELETE FROM pages
WHERE id = '018f1090-0840-7000-8000-000000000001'::uuid;

INSERT INTO pages (id, tenant_id, slug, created_at, updated_at)
SELECT
    '018f1090-0840-7000-8000-000000000001'::uuid,
    t.id,
    '/about',
    '2026-02-09T09:00:00Z'::timestamptz,
    '2026-02-09T09:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'ModrTNNTAAA1';

INSERT INTO page_translations (id, page_id, tenant_id, locale, title, created_at, updated_at)
SELECT
    '018f1090-0840-7000-8000-000000000002'::uuid,
    p.id,
    p.tenant_id,
    t.default_locale,
    'About us',
    p.created_at,
    p.created_at
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE p.id = '018f1090-0840-7000-8000-000000000001'::uuid;

COMMIT;
