-- name: GetPlatformPolicyConfig :one
-- Returns no rows when the platform has never saved its policy, which the
-- server answers with its built-in defaults.
SELECT *
FROM platform_policy_config
WHERE singleton = TRUE;

-- name: LockPlatformPolicyConfig :one
-- Reads the policy row for update, so the revision a save compares against
-- cannot change between the comparison and the write.
SELECT *
FROM platform_policy_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: InsertPlatformPolicyConfig :one
-- No ON CONFLICT clause: an absent row leaves LockPlatformPolicyConfig nothing
-- to lock, so a losing racer must fail on the primary key rather than overwrite
-- the row the winner just created.
INSERT INTO platform_policy_config (
        singleton,
        mfa_required_for_tenant_admin,
        password_verify_limit_per_minute,
        password_verify_limit_per_day,
        mail_request_limit_per_address_per_hour,
        mail_request_limit_per_address_per_day,
        mail_request_limit_per_source_per_hour,
        mail_request_limit_per_source_per_day,
        comment_post_limit_per_minute,
        comment_post_limit_per_day,
        comment_report_limit_per_minute,
        comment_report_limit_per_day,
        comment_duplicate_window_minutes,
        episode_rating_limit_per_minute,
        episode_rating_limit_per_day,
        contact_message_limit_per_account_per_hour,
        contact_message_limit_per_account_per_day,
        contact_message_limit_per_client_per_hour,
        contact_message_limit_per_client_per_day,
        viewer_preferences_limit_per_minute,
        viewer_preferences_limit_per_day,
        store_purchase_confirm_limit_per_minute,
        store_purchase_confirm_limit_per_day,
        wait_free_ticket_use_limit_per_minute,
        wait_free_ticket_use_limit_per_day,
        login_account_limit_per_minute,
        login_account_limit_per_day,
        login_source_limit_per_hour,
        login_source_limit_per_day,
        disposable_email_domains_url,
        updated_at
    )
VALUES (
        TRUE,
        sqlc.arg('mfa_required_for_tenant_admin'),
        sqlc.arg('password_verify_limit_per_minute'),
        sqlc.arg('password_verify_limit_per_day'),
        sqlc.arg('mail_request_limit_per_address_per_hour'),
        sqlc.arg('mail_request_limit_per_address_per_day'),
        sqlc.arg('mail_request_limit_per_source_per_hour'),
        sqlc.arg('mail_request_limit_per_source_per_day'),
        sqlc.arg('comment_post_limit_per_minute'),
        sqlc.arg('comment_post_limit_per_day'),
        sqlc.arg('comment_report_limit_per_minute'),
        sqlc.arg('comment_report_limit_per_day'),
        sqlc.arg('comment_duplicate_window_minutes'),
        sqlc.arg('episode_rating_limit_per_minute'),
        sqlc.arg('episode_rating_limit_per_day'),
        sqlc.arg('contact_message_limit_per_account_per_hour'),
        sqlc.arg('contact_message_limit_per_account_per_day'),
        sqlc.arg('contact_message_limit_per_client_per_hour'),
        sqlc.arg('contact_message_limit_per_client_per_day'),
        sqlc.arg('viewer_preferences_limit_per_minute'),
        sqlc.arg('viewer_preferences_limit_per_day'),
        sqlc.arg('store_purchase_confirm_limit_per_minute'),
        sqlc.arg('store_purchase_confirm_limit_per_day'),
        sqlc.arg('wait_free_ticket_use_limit_per_minute'),
        sqlc.arg('wait_free_ticket_use_limit_per_day'),
        sqlc.arg('login_account_limit_per_minute'),
        sqlc.arg('login_account_limit_per_day'),
        sqlc.arg('login_source_limit_per_hour'),
        sqlc.arg('login_source_limit_per_day'),
        sqlc.arg('disposable_email_domains_url'),
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformPolicyConfig :one
-- Writes every value over the existing row. The revision moves with every
-- write, which is what makes a save based on an earlier read detectable.
UPDATE platform_policy_config
SET mfa_required_for_tenant_admin = sqlc.arg('mfa_required_for_tenant_admin'),
    password_verify_limit_per_minute = sqlc.arg('password_verify_limit_per_minute'),
    password_verify_limit_per_day = sqlc.arg('password_verify_limit_per_day'),
    mail_request_limit_per_address_per_hour = sqlc.arg('mail_request_limit_per_address_per_hour'),
    mail_request_limit_per_address_per_day = sqlc.arg('mail_request_limit_per_address_per_day'),
    mail_request_limit_per_source_per_hour = sqlc.arg('mail_request_limit_per_source_per_hour'),
    mail_request_limit_per_source_per_day = sqlc.arg('mail_request_limit_per_source_per_day'),
    comment_post_limit_per_minute = sqlc.arg('comment_post_limit_per_minute'),
    comment_post_limit_per_day = sqlc.arg('comment_post_limit_per_day'),
    comment_report_limit_per_minute = sqlc.arg('comment_report_limit_per_minute'),
    comment_report_limit_per_day = sqlc.arg('comment_report_limit_per_day'),
    comment_duplicate_window_minutes = sqlc.arg('comment_duplicate_window_minutes'),
    episode_rating_limit_per_minute = sqlc.arg('episode_rating_limit_per_minute'),
    episode_rating_limit_per_day = sqlc.arg('episode_rating_limit_per_day'),
    contact_message_limit_per_account_per_hour = sqlc.arg('contact_message_limit_per_account_per_hour'),
    contact_message_limit_per_account_per_day = sqlc.arg('contact_message_limit_per_account_per_day'),
    contact_message_limit_per_client_per_hour = sqlc.arg('contact_message_limit_per_client_per_hour'),
    contact_message_limit_per_client_per_day = sqlc.arg('contact_message_limit_per_client_per_day'),
    viewer_preferences_limit_per_minute = sqlc.arg('viewer_preferences_limit_per_minute'),
    viewer_preferences_limit_per_day = sqlc.arg('viewer_preferences_limit_per_day'),
    store_purchase_confirm_limit_per_minute = sqlc.arg('store_purchase_confirm_limit_per_minute'),
    store_purchase_confirm_limit_per_day = sqlc.arg('store_purchase_confirm_limit_per_day'),
    wait_free_ticket_use_limit_per_minute = sqlc.arg('wait_free_ticket_use_limit_per_minute'),
    wait_free_ticket_use_limit_per_day = sqlc.arg('wait_free_ticket_use_limit_per_day'),
    login_account_limit_per_minute = sqlc.arg('login_account_limit_per_minute'),
    login_account_limit_per_day = sqlc.arg('login_account_limit_per_day'),
    login_source_limit_per_hour = sqlc.arg('login_source_limit_per_hour'),
    login_source_limit_per_day = sqlc.arg('login_source_limit_per_day'),
    disposable_email_domains_url = sqlc.arg('disposable_email_domains_url'),
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;
