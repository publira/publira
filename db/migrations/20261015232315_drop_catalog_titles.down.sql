ALTER TABLE ONLY series
    ADD COLUMN title text;

ALTER TABLE ONLY series_listings
    ADD COLUMN synopsis text;

ALTER TABLE ONLY episodes
    ADD COLUMN title text;

-- A series and an episode take back their default-locale translation, or
-- their oldest one when the tenant has since changed its default locale.
UPDATE series s
SET title = (SELECT st.title FROM series_translation_for(s.id, '') st);

UPDATE series_listings sl
SET synopsis = (SELECT NULLIF(st.synopsis, '') FROM series_translation_for(sl.series_id, '') st);

UPDATE episodes e
SET title = (SELECT et.title FROM episode_translation_for(e.id, '') et);

ALTER TABLE ONLY series
    ALTER COLUMN title SET NOT NULL;

ALTER TABLE ONLY episodes
    ALTER COLUMN title SET NOT NULL;

CREATE INDEX idx_series_tenant_title ON series USING btree (tenant_id, is_published, title, id);

CREATE INDEX idx_series_tenant_label_title ON series USING btree (tenant_id, label_id, is_published, title, id);
