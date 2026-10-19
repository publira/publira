ALTER TABLE ONLY genres
    ADD COLUMN name text;

-- A genre takes back its default-locale name, or its oldest one when the tenant
-- has since changed its default locale.
UPDATE genres g
SET name = chosen.name
FROM (
        SELECT DISTINCT ON (gt.genre_id) gt.genre_id, gt.name
        FROM genre_translations gt
            JOIN tenants t ON t.id = gt.tenant_id
        ORDER BY gt.genre_id, (gt.locale = t.default_locale) DESC, gt.created_at, gt.id
    ) chosen
WHERE chosen.genre_id = g.id;

ALTER TABLE ONLY genres
    ALTER COLUMN name SET NOT NULL;
