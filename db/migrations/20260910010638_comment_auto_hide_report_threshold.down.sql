ALTER TABLE tenant_config
    DROP CONSTRAINT tenant_config_comment_auto_hide_report_threshold_check;

ALTER TABLE tenant_config
    DROP COLUMN comment_auto_hide_report_threshold;
