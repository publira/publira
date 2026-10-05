-- name: GetPlatformSearchConfig :one
-- Returns no rows when the platform has never saved a search engine, which is
-- the SQL engine every process searches with until one is.
SELECT *
FROM platform_search_config
WHERE singleton = TRUE;

-- name: LockPlatformSearchConfig :one
-- Reads the row for update, so the revision a save compares against cannot
-- change between the comparison and the write.
SELECT *
FROM platform_search_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: InsertPlatformSearchConfig :one
-- No ON CONFLICT clause: an absent row leaves LockPlatformSearchConfig nothing
-- to lock, so a losing racer must fail on the primary key rather than
-- overwrite the row the winner just created. serve moves the search onto the
-- saved configuration in the same write, which is what a save that needs no
-- index built asks for; otherwise the search stays on the SQL engine an absent
-- row stood for.
INSERT INTO platform_search_config (
        singleton,
        engine,
        url,
        index_alias,
        username,
        password_encrypted,
        serving_revision,
        serving_engine,
        serving_url,
        serving_index_alias,
        serving_username,
        serving_password_encrypted,
        serving_since,
        updated_at
    )
VALUES (
        TRUE,
        sqlc.arg('engine'),
        sqlc.narg('url'),
        sqlc.narg('index_alias'),
        sqlc.narg('username'),
        sqlc.narg('password_encrypted'),
        CASE WHEN sqlc.arg('serve')::boolean THEN 1 ELSE 0 END,
        CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.arg('engine') ELSE 'sql' END,
        CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('url') END,
        CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('index_alias') END,
        CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('username') END,
        CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('password_encrypted') END,
        CASE WHEN sqlc.arg('serve')::boolean THEN NOW() END,
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformSearchConfig :one
-- Writes every saved value over the existing row. The revision moves with
-- every write, which is what makes a save based on an earlier read detectable,
-- and a build failure recorded for an earlier revision is cleared, since
-- nothing is building that revision any more. serve moves the search onto the
-- saved configuration in the same write; otherwise it stays where it is until
-- the worker has built the index the save names.
UPDATE platform_search_config
SET engine = sqlc.arg('engine'),
    url = sqlc.narg('url'),
    index_alias = sqlc.narg('index_alias'),
    username = sqlc.narg('username'),
    password_encrypted = sqlc.narg('password_encrypted'),
    revision = revision + 1,
    serving_revision = CASE WHEN sqlc.arg('serve')::boolean THEN revision + 1 ELSE serving_revision END,
    serving_engine = CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.arg('engine') ELSE serving_engine END,
    serving_url = CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('url') ELSE serving_url END,
    serving_index_alias = CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('index_alias') ELSE serving_index_alias END,
    serving_username = CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('username') ELSE serving_username END,
    serving_password_encrypted = CASE WHEN sqlc.arg('serve')::boolean THEN sqlc.narg('password_encrypted') ELSE serving_password_encrypted END,
    serving_since = CASE WHEN sqlc.arg('serve')::boolean THEN NOW() ELSE serving_since END,
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;

-- name: ServePlatformSearchConfig :one
-- Moves the search onto the saved configuration once the index it names has
-- been built, provided it is still the one built: no rows when a save has
-- moved the revision on since the build read it, whose own build comes next.
UPDATE platform_search_config
SET serving_revision = revision,
    serving_engine = engine,
    serving_url = url,
    serving_index_alias = index_alias,
    serving_username = username,
    serving_password_encrypted = password_encrypted,
    serving_since = NOW(),
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL
WHERE singleton = TRUE
    AND revision = sqlc.arg('revision')
RETURNING *;

-- name: RecordPlatformSearchBuildFailure :execrows
-- Records why the build of a revision failed, unless a save has moved the
-- revision on since, which leaves the failure about nothing.
UPDATE platform_search_config
SET build_failed_revision = revision,
    build_error = sqlc.arg('build_error')::text,
    build_failed_at = NOW()
WHERE singleton = TRUE
    AND revision = sqlc.arg('revision');
