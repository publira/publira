-- Dropping the column takes its foreign key and its CHECK constraints with it.
ALTER TABLE ONLY users
    DROP COLUMN icon_preset_id;

DROP TABLE reader_icon_preset_variants;

DROP TABLE reader_icon_presets;

ALTER TABLE tenant_config
    DROP CONSTRAINT tenant_config_reader_icon_policy_check;

ALTER TABLE tenant_config
    DROP COLUMN reader_icon_policy;
