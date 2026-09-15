-- name: GetUserViewerPreferences :one
SELECT *
FROM user_viewer_preferences
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id');

-- name: UpsertUserViewerPreferences :one
-- An omitted (NULL) preference keeps the value the row holds, so a viewer that
-- writes the one control the reader just pressed cannot reset the settings it
-- knows nothing about.
--
-- On the insert branch there is no value to keep, and an omitted preference
-- takes the same default GetUserViewerPreferences answers for a reader with no
-- row. The literal repeats the column default because a VALUES list has no way
-- to ask for it conditionally; TestDBViewerPreferenceDefaultsAgreeAcrossPaths
-- is what fails when the two drift apart.
INSERT INTO user_viewer_preferences (tenant_id, user_id, wide_viewer_enabled, updated_at)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    COALESCE(sqlc.narg('wide_viewer_enabled')::boolean, false),
    NOW()
)
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET wide_viewer_enabled = COALESCE(sqlc.narg('wide_viewer_enabled')::boolean, user_viewer_preferences.wide_viewer_enabled),
    updated_at = NOW()
RETURNING *;
