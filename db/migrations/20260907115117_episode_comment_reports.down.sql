DROP TABLE IF EXISTS episode_comment_reports;

-- Dropping the column takes episode_comments_open_report_count_check with it.
ALTER TABLE episode_comments
    DROP COLUMN open_report_count;

ALTER TABLE episode_comments
    DROP CONSTRAINT episode_comments_tenant_id_id_key;
