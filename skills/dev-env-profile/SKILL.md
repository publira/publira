---
name: dev-env-profile
description: Prepare or verify an isolated local development profile before implementation or runtime verification in a Git worktree. Use when starting or resuming development outside the shared default environment; do not use for E2E stacks.
---

# Dev Env Profile

Use the worktree's selected profile as the local development boundary. It isolates the PostgreSQL database, Valkey logical database, RustFS bucket, service ports, and browser Cookie names from other worktrees. Do not substitute the shared development defaults for an unselected profile.

Before editing application code or starting a runtime server in a worktree:

1. Run `task dev-env:show`. If a profile is selected, confirm that its displayed name and worktree are the intended target.
2. If no profile is selected, create one with a short identifier that describes the worktree, using `task dev-env:create NAME=<identifier>`. This records the selection in the ignored `.publira-dev-env` file; never copy another worktree's selection. The profile also records the PostgreSQL, Valkey, and RustFS hosts from `PUBLIRA_DB_URL`, `PUBLIRA_REDIS_URL`, and `PUBLIRA_S3_ENDPOINT` as exported at that moment, falling back to the Compose service names. Inside the Dev Container nothing needs to be exported; on the host, export the loopback values from the README section on running `task setup` / `task dev` on the host before creating the profile.
3. Run `task dev-env:init` before a task that needs data or object storage. It is idempotent and prepares only the selected profile's database and bucket.

For a complete local stack, use `task dev-env:start`; it prints the profile-specific URLs and writes process logs under `~/.publira/dev-env/runs/<profile>/`. Use `task dev-env:stop` when finished. For a single app or command, use `eval "$(task --silent dev-env:env)"` in that shell before the normal command so it receives the same profile-scoped URLs and credentials.

Never run `task dev-env:destroy` merely to make a profile reusable. It destroys that profile's database, Valkey DB, and bucket after confirmation, refuses profiles selected by any worktree, and must be requested explicitly by the user. It must never be used for the shared default development environment or an E2E profile.

When diagnosing an unexpected connection, run `task dev-env:show` and inspect the profile's URL, slot, and bucket before changing code. Keep `PUBLIRA_CACHE_APP` as the per-application cache namespace; the Redis logical database is the worktree boundary.
