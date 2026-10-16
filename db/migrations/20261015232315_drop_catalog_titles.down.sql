ALTER TABLE ONLY series
    ADD COLUMN title text;

ALTER TABLE ONLY series_listings
    ADD COLUMN synopsis text;

ALTER TABLE ONLY episodes
    ADD COLUMN title text;

-- A series and an episode take back their default-locale translation, or
-- their oldest one when the tenant has since changed its default locale.
UPDATE series s
SET title = st.title
FROM series_translations st
WHERE st.id = series_translation_for(s.id, '');

UPDATE series_listings sl
SET synopsis = NULLIF(st.synopsis, '')
FROM series_translations st
WHERE st.id = series_translation_for(sl.series_id, '');

UPDATE episodes e
SET title = et.title
FROM episode_translations et
WHERE et.id = episode_translation_for(e.id, '');

ALTER TABLE ONLY series
    ALTER COLUMN title SET NOT NULL;

ALTER TABLE ONLY episodes
    ALTER COLUMN title SET NOT NULL;

CREATE INDEX idx_series_tenant_title ON series USING btree (tenant_id, is_published, title, id);

CREATE INDEX idx_series_tenant_label_title ON series USING btree (tenant_id, label_id, is_published, title, id);
