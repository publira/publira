# Environment variables: `PUBLIRA_*`

Every environment variable that **only this repository's own code reads** is named `PUBLIRA_*`. A variable keeps its outside name only when the software that consumes the value looks that name up itself.

That test — who performs the lookup — is the whole rule. It is not about whether a name is conventional, and not about whether the value belongs to a third party.

| Category | Naming | Examples |
| --- | --- | --- |
| Only this repository's code reads it | `PUBLIRA_*` | `PUBLIRA_DB_URL`, `PUBLIRA_PUBLIC_API_ADDR`, `PUBLIRA_S3_BUCKET`, `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_REDIS_URL`, `PUBLIRA_CACHE_APP` |
| An external SDK / framework / runtime reads it out of the environment itself | keep the name that software documents | `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (AWS SDK, `aws` CLI), `NODE_ENV`, `PORT`, `HOST` / `HOSTNAME`, `CI`, `NEXT_PHASE`, `NEXT_PRIVATE_*`, `__NEXT_*` |
| Test-harness knobs rather than application config | out of scope for this rule | `E2E_*`, `BOOTSTRAP_*`, `ROUTING_*` |

## Names that look like exceptions and are not

- **`S3_*`** were never AWS SDK variables — `server/config/runtime.go` reads them — so they are `PUBLIRA_S3_BUCKET`, `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_S3_FORCE_PATH_STYLE`, and so on. Only the `AWS_*` credentials and region in the table above are looked up by the SDK and the `aws` CLI.
- **`AUTH_SECRET` is not an Auth.js variable.** This repository does not use Auth.js / NextAuth; the only reader is `resolveAuthSecret()` in `packages/web-session`, which encrypts the session JWE with `jose`. Hence `PUBLIRA_AUTH_SECRET`.
- **`NEXT_*` is not a blanket exception.** Next.js itself reads `NEXT_PHASE`, `NEXT_PRIVATE_DEBUG_CACHE`, and `__NEXT_DEV_SERVER`. The cache and revalidation variables belong to our own implementation (`@publira/next-cache-handlers`, the `/api/revalidate` Route Handler), where the `NEXT_` prefix only made them look like framework settings — hence `PUBLIRA_CACHE_APP`, `PUBLIRA_CACHE_KEY_PREFIX`, and `PUBLIRA_REVALIDATE_TOKEN`.
- **A de-facto generic name is not a vendor name.** Nothing but `@publira/next-cache-handlers` reads `REDIS_URL` and `REDIS_CACHE_TIMEOUT_MS`; the `redis` client is handed the connection string and the timeout explicitly. They are therefore `PUBLIRA_REDIS_URL` and `PUBLIRA_REDIS_CACHE_TIMEOUT_MS`, the same category as `PUBLIRA_DB_URL`.

## Adding a variable

`turbo.json`'s `dev` task declares `"passThroughEnv": ["PUBLIRA_*"]`, and turbo defaults to strict env mode. A conforming name reaches the dev servers with no further edit; a non-conforming one needs a hand-written exception in `turbo.json`, `.devcontainer/compose.yaml`, `e2e/scripts/*`, `e2e/bootstrap/scripts/*`, and CI — and wherever that exception is missed, the variable silently does nothing while everything still starts.

- **Do not add an entry to `passThroughEnv`** to make a non-`PUBLIRA_*` name reach an app. Rename the variable.
- Add the variable to the owning README (`server/README.md`, `server/cmd/*/README.md`, `apps/*/README.md`, `packages/*/README.md`) in the same change.
- The current inventory is `git grep -o 'os\.Getenv("[A-Z0-9_]*")' -- server` and `git grep -oE 'process\.env\.[A-Z0-9_]+' -- apps packages`.
