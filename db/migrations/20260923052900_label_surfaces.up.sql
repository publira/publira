-- VIEW: label_surfaces
-- One row per label and surface its public list and detail may show it on. A
-- label with no published series is on both surfaces, so its URL keeps working
-- after its last series is taken down. A label with published series is on a
-- surface only when one of them may be shown there; otherwise every link under
-- it would lead to an empty page. The label list and the label detail ask the
-- same question, and spelling it out in each is how the two come to disagree.
--
-- security_invoker keeps the row-level security of labels and series the
-- caller's own; without it the view would run with the rights of the role that
-- applies migrations, which bypasses RLS.
CREATE VIEW label_surfaces WITH (security_invoker = true) AS
SELECT l.id AS label_id,
    l.tenant_id,
    v.surface
FROM labels l
    CROSS JOIN (
        SELECT 'web'::text AS surface
        UNION ALL
        SELECT 'app'::text AS surface
    ) v
WHERE NOT EXISTS (
        SELECT 1
        FROM series s
        WHERE s.label_id = l.id
            AND s.tenant_id = l.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    OR EXISTS (
        SELECT 1
        FROM series s
            JOIN series_surfaces ss ON ss.series_id = s.id
        WHERE s.label_id = l.id
            AND s.tenant_id = l.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
            AND ss.surface = v.surface
    );
