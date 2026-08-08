-- pages シード: プライバシーポリシーと利用規約のサンプルデータ
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = '018F0E6A1000'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug, title)
SELECT
    '018f1000-0001-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/privacy',
    'プライバシーポリシー'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## 個人情報の取得について\n\n本サービスでは、会員登録・サービス利用にあたり必要最小限の個人情報を取得します。\n\n## 個人情報の利用目的\n\n取得した個人情報は以下の目的でのみ利用します。\n\n- サービスの提供・運営\n- ユーザーへのお知らせ・連絡\n- サービス改善のための統計分析\n\n## 第三者提供について\n\n法令に基づく場合を除き、個人情報を第三者に提供することはありません。\n\n## お問い合わせ\n\nプライバシーに関するご質問はサポートまでご連絡ください。',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
WHERE pv.id = '018f1000-0002-7000-8000-000000000001'::uuid
  AND p.slug = '/privacy'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0002-7000-8000-000000000001'::uuid,
    p.id,
    p.tenant_id,
    1,
    E'## 個人情報の取得について\n\n本サービスでは、会員登録・サービス利用にあたり必要最小限の個人情報を取得します。\n\n## 個人情報の利用目的\n\n取得した個人情報は以下の目的でのみ利用します。\n\n- サービスの提供・運営\n- ユーザーへのお知らせ・連絡\n- サービス改善のための統計分析\n\n## 第三者提供について\n\n法令に基づく場合を除き、個人情報を第三者に提供することはありません。\n\n## お問い合わせ\n\nプライバシーに関するご質問はサポートまでご連絡ください。',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
WHERE p.slug = '/privacy'
  AND p.tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0002-7000-8000-000000000001'::uuid
  );

UPDATE pages
SET published_version_id = '018f1000-0002-7000-8000-000000000001'::uuid,
    display_in_footer = true
WHERE slug = '/privacy'
  AND tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  );

WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = '018F0E6A1000'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug, title)
SELECT
    '018f1000-0003-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/terms',
    '利用規約'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## 第1条（適用）\n\n本規約は、本サービスの利用に関する条件を定めるものです。ユーザーは本規約に同意の上、本サービスを利用してください。\n\n## 第2条（利用登録）\n\n利用登録は、所定の登録フォームに必要事項を入力し、運営者が承認した時点で完了します。\n\n## 第3条（禁止事項）\n\n以下の行為を禁止します。\n\n- 法令または公序良俗に違反する行為\n- 本サービスの運営を妨害する行為\n- 他のユーザーへの迷惑行為\n\n## 第4条（免責事項）\n\n本サービスの利用により生じた損害について、運営者は一切の責任を負いません。\n\n## 第5条（規約の変更）\n\n運営者は必要に応じて本規約を変更できます。変更後の規約はサービス上に掲載した時点で効力を生じます。',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
WHERE pv.id = '018f1000-0004-7000-8000-000000000001'::uuid
  AND p.slug = '/terms'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0004-7000-8000-000000000001'::uuid,
    p.id,
    p.tenant_id,
    1,
    E'## 第1条（適用）\n\n本規約は、本サービスの利用に関する条件を定めるものです。ユーザーは本規約に同意の上、本サービスを利用してください。\n\n## 第2条（利用登録）\n\n利用登録は、所定の登録フォームに必要事項を入力し、運営者が承認した時点で完了します。\n\n## 第3条（禁止事項）\n\n以下の行為を禁止します。\n\n- 法令または公序良俗に違反する行為\n- 本サービスの運営を妨害する行為\n- 他のユーザーへの迷惑行為\n\n## 第4条（免責事項）\n\n本サービスの利用により生じた損害について、運営者は一切の責任を負いません。\n\n## 第5条（規約の変更）\n\n運営者は必要に応じて本規約を変更できます。変更後の規約はサービス上に掲載した時点で効力を生じます。',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
WHERE p.slug = '/terms'
  AND p.tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0004-7000-8000-000000000001'::uuid
  );

UPDATE pages
SET published_version_id = '018f1000-0004-7000-8000-000000000001'::uuid,
    display_in_footer = true
WHERE slug = '/terms'
  AND tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  );

-- Multi-segment slug sample for /legal/terms public URL coverage
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = '018F0E6A1000'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug, title)
SELECT
    '018f1000-0005-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/legal/terms',
    '階層スラッグテスト'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## 階層 slug テスト\n\n`/legal/terms` が表示できていれば OK です。',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
WHERE pv.id = '018f1000-0006-7000-8000-000000000001'::uuid
  AND p.slug = '/legal/terms'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0006-7000-8000-000000000001'::uuid,
    p.id,
    p.tenant_id,
    1,
    E'## 階層 slug テスト\n\n`/legal/terms` が表示できていれば OK です。',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
WHERE p.slug = '/legal/terms'
  AND p.tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0006-7000-8000-000000000001'::uuid
  );

UPDATE pages
SET published_version_id = '018f1000-0006-7000-8000-000000000001'::uuid
WHERE slug = '/legal/terms'
  AND tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = '018F0E6A1000'
  );
