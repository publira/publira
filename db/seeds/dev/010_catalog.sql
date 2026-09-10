-- public_id is 12 standard Base58 characters, the format server/internal/publicid
-- generates. Seed rows use a fixed value instead of a random one: `Seed` + a
-- 4-letter kind + the 4-digit seed number with `0` written as `A`, since Base58
-- has no `0`. `Seed Series 001` is `SeedSERSAAA1`, episode 1000 is `SeedEPSD1AAA`.

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
label_seed AS (
    SELECT
        gs.n,
        (
            '018f0e70-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id
    FROM GENERATE_SERIES(1, 10) AS gs(n)
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id,
    ts.id,
    'SeedLABL' || TRANSLATE(LPAD(ls.n::text, 4, '0'), '0', 'A'),
    FORMAT('Seed Label %s', LPAD(ls.n::text, 2, '0'))
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
creator_seed AS (
    SELECT
        gs.n,
        (
            '018f0e71-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id
    FROM GENERATE_SERIES(1, 100) AS gs(n)
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id,
    ts.id,
    'SeedAUTH' || TRANSLATE(LPAD(cs.n::text, 4, '0'), '0', 'A'),
    FORMAT('Seed Author %s', LPAD(cs.n::text, 3, '0')),
    FORMAT('Profile text for Seed Author %s', LPAD(cs.n::text, 3, '0'))
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
label_pool AS (
    SELECT
        l.id,
        ROW_NUMBER() OVER (ORDER BY l.name) AS label_no
    FROM labels l
    JOIN tenant_scope ts ON ts.id = l.tenant_id
    WHERE l.name LIKE 'Seed Label %'
),
series_seed AS (
    SELECT
        gs.n,
        (
            '018f0e72-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id,
        ((gs.n - 1) % 10) + 1 AS label_no
    FROM GENERATE_SERIES(1, 100) AS gs(n)
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    ss.id,
    ts.id,
    lp.id,
    'SeedSERS' || TRANSLATE(LPAD(ss.n::text, 4, '0'), '0', 'A'),
    FORMAT('Seed Series %s', LPAD(ss.n::text, 3, '0')),
    true,
    (
        date_trunc('day', NOW() AT TIME ZONE 'Asia/Tokyo')
        + make_interval(
            days => (GET_BYTE(DECODE(MD5(ss.id::text), 'hex'), 0) % 101) - 50
        )
    ) AT TIME ZONE 'Asia/Tokyo'
FROM series_seed ss
JOIN label_pool lp ON lp.label_no = ss.label_no
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

-- Every tenth series has ended and every tenth-but-five is paused, so the
-- storefront's status filter has all three states to select between and each
-- of the two narrow ones answers with a page rather than an empty state.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        s.public_id,
        s.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
)
INSERT INTO series_listings (
    series_id,
    synopsis,
    reading_period_hours,
    status,
    tenant_id
)
SELECT
    ss.id,
    FORMAT('Seed series synopsis for %s', ss.public_id),
    72,
    CASE ss.series_no % 10
        WHEN 0 THEN 'completed'
        WHEN 5 THEN 'hiatus'
        ELSE 'ongoing'
    END,
    ss.tenant_id
FROM seed_series ss
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    tenant_id = EXCLUDED.tenant_id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id AS series_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
seed_creators AS (
    SELECT
        c.id AS creator_id,
        ROW_NUMBER() OVER (ORDER BY c.name) AS creator_no
    FROM creators c
    JOIN tenant_scope ts ON ts.id = c.tenant_id
    WHERE c.name LIKE 'Seed Author %'
)
INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id)
SELECT
    ss.series_id,
    sc.creator_id,
    cr.id,
    1,
    s.tenant_id
FROM seed_series ss
JOIN seed_creators sc ON sc.creator_no = ss.series_no
JOIN series s ON s.id = ss.series_id
JOIN creator_roles cr ON cr.tenant_id = s.tenant_id AND cr.name = 'Original Author'
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
episode_seed AS (
    SELECT
        ss.id AS series_id,
        ss.series_no,
        ep.ep_no,
        ((ss.series_no - 1) * 10 + ep.ep_no) AS seq_no,
        (
            '018f0e73-'
            || LPAD(TO_HEX(((ss.series_no - 1) * 10 + ep.ep_no)), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(((ss.series_no - 1) * 10 + ep.ep_no)), 12, '0')
        )::uuid AS id
    FROM seed_series ss
    CROSS JOIN GENERATE_SERIES(1, 10) AS ep(ep_no)
)
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id,
    es.series_id,
    'SeedEPSD' || TRANSLATE(LPAD(es.seq_no::text, 4, '0'), '0', 'A'),
    FORMAT(
        'Seed Episode %s-%s',
        LPAD(es.series_no::text, 3, '0'),
        LPAD(es.ep_no::text, 2, '0')
    ),
    es.ep_no,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.id = es.series_id
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
)
INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at,
    tenant_id
)
SELECT
    e.id,
    0,
    72,
    'published',
    NULL,
    s.published_at + (e.order_index::int * INTERVAL '6 hours'),
    s.tenant_id
FROM episodes e
JOIN series s ON s.id = e.series_id
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Seed Series %'
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

UPDATE series
SET is_published = (published_at IS NOT NULL),
        updated_at = NOW()
WHERE title LIKE 'Seed Series %'
    AND is_published IS DISTINCT FROM (published_at IS NOT NULL);

-- Paid episode for access-ticket / purchase testing (Seed Episode 001-10).
UPDATE episode_listings el
SET price = 500,
    reading_period_hours = 72
FROM episodes e
JOIN series s ON s.id = e.series_id
JOIN tenants t ON t.id = s.tenant_id
WHERE el.episode_id = e.id
    AND t.domain = 'localhost'
    AND e.title = 'Seed Episode 001-10';

-- The two ways into the catalogue other than the alphabet. Genres are the
-- classification the tenant curates, so they are fixed rows in a fixed order;
-- tags exist because a series carries one, so they are seeded through the
-- assignments below and nowhere else.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
genre_seed (n, name, slug) AS (
    VALUES
        (1, 'Fantasy', 'fantasy'),
        (2, 'Romance', 'romance'),
        (3, 'Mystery', 'mystery'),
        (4, 'Science fiction', 'science-fiction'),
        (5, 'Slice of life', 'slice-of-life'),
        (6, 'Action', 'action')
)
INSERT INTO genres (id, tenant_id, public_id, name, slug, display_order)
SELECT
    (
        '018f0e74-'
        || LPAD(TO_HEX(gs.n), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(gs.n), 12, '0')
    )::uuid,
    ts.id,
    'SeedGENR' || TRANSLATE(LPAD(gs.n::text, 4, '0'), '0', 'A'),
    gs.name,
    gs.slug,
    gs.n
FROM genre_seed gs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    display_order = EXCLUDED.display_order;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
tag_seed (n, name, slug) AS (
    VALUES
        (1, 'Time travel', 'time-travel'),
        (2, 'School life', 'school-life'),
        (3, 'Found family', 'found-family'),
        (4, 'Slow burn', 'slow-burn')
)
INSERT INTO tags (id, tenant_id, name, slug)
SELECT
    (
        '018f0e75-'
        || LPAD(TO_HEX(tg.n), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(tg.n), 12, '0')
    )::uuid,
    ts.id,
    tg.name,
    tg.slug
FROM tag_seed tg
CROSS JOIN tenant_scope ts
ON CONFLICT (tenant_id, slug) DO UPDATE
SET name = EXCLUDED.name;

-- One genre and one tag each, dealt round-robin over the series in title
-- order, so every genre and every tag holds a page of series and the filtered
-- lists stay the same between runs.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        s.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
seed_genres AS (
    SELECT
        g.id,
        g.tenant_id,
        g.display_order AS genre_no
    FROM genres g
    JOIN tenant_scope ts ON ts.id = g.tenant_id
    WHERE g.public_id LIKE 'SeedGENR%'
)
INSERT INTO series_genres (tenant_id, series_id, genre_id)
SELECT
    ss.tenant_id,
    ss.id,
    sg.id
FROM seed_series ss
JOIN seed_genres sg
    ON sg.tenant_id = ss.tenant_id
    AND sg.genre_no = ((ss.series_no - 1) % 6) + 1
ON CONFLICT (series_id, genre_id) DO NOTHING;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        s.tenant_id,
        ROW_NUMBER() OVER (ORDER BY s.title) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
seed_tags AS (
    SELECT
        tg.id,
        tg.tenant_id,
        ROW_NUMBER() OVER (ORDER BY tg.slug) AS tag_no
    FROM tags tg
    JOIN tenant_scope ts ON ts.id = tg.tenant_id
    WHERE tg.slug IN ('found-family', 'school-life', 'slow-burn', 'time-travel')
)
INSERT INTO series_tags (tenant_id, series_id, tag_id)
SELECT
    ss.tenant_id,
    ss.id,
    st.id
FROM seed_series ss
JOIN seed_tags st
    ON st.tenant_id = ss.tenant_id
    AND st.tag_no = ((ss.series_no - 1) % 4) + 1
ON CONFLICT (series_id, tag_id) DO NOTHING;
