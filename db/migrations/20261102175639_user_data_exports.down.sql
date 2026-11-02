-- A row filed under 'account' has no other category it could take, so it goes
-- with the category. Its notification_type is one the release before has no
-- copy for either.
DELETE FROM notifications
WHERE category = 'account';

ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'everyone'::text, 'staff'::text])));

ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_data_export_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN data_export_limit_per_day,
    DROP COLUMN data_export_limit_per_hour;

DROP TABLE user_data_exports;
