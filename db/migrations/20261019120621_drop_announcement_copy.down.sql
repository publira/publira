ALTER TABLE ONLY announcements
    ADD COLUMN title text,
    ADD COLUMN body text;

-- An announcement takes back its default-locale translation, or its oldest one
-- when the tenant has since changed its default locale.
UPDATE announcements a
SET (title, body) = (
        SELECT at.title, at.body
        FROM announcement_translation_for(a.id, '') at
    );

ALTER TABLE ONLY announcements
    ALTER COLUMN title SET NOT NULL,
    ALTER COLUMN body SET NOT NULL;
