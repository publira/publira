ALTER TABLE tenant_themes
    ADD COLUMN serif_font_family character varying(512) NOT NULL DEFAULT '',
    ADD COLUMN sans_font_family character varying(512) NOT NULL DEFAULT '';
