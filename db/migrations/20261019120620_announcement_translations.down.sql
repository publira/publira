ALTER TABLE ONLY users
    DROP COLUMN last_locale;

DROP FUNCTION announcement_translation_for(uuid, text);

DROP TABLE announcement_translations;
