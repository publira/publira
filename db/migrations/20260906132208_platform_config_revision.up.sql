-- Version the settings row so a save can state which version it is based on.
--
-- platform_config is written as a whole row, so a screen that saves one field
-- has to send the others back unchanged. Without a version, a save that read
-- the row before another one committed silently reverts that other save. Every
-- writer bumps this counter, and a writer that states a stale one is refused.
ALTER TABLE ONLY platform_config
    ADD COLUMN revision bigint DEFAULT 1 NOT NULL,
    ADD CONSTRAINT platform_config_revision_positive_check CHECK ((revision > 0));
