-- Version the platform SMTP row so a save can state which version it is based
-- on.
--
-- The settings screen writes the whole row and carries the stored password
-- forward when the operator did not retype it. Without a version, a save that
-- read the row before another one committed silently reverts that other save,
-- the password included. Every writer bumps this counter, and a writer that
-- states a stale one is refused.
ALTER TABLE ONLY platform_smtp_config
    ADD COLUMN revision bigint DEFAULT 1 NOT NULL,
    ADD CONSTRAINT platform_smtp_config_revision_positive_check CHECK ((revision > 0));
