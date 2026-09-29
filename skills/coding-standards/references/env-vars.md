# Environment variables: `PUBLIRA_*`

Every environment variable that **only this repository's own code reads** is named `PUBLIRA_*`. A variable keeps its outside name only when the software that consumes the value looks that name up itself.

That test — who performs the lookup — is the whole rule. It is not about whether a name is conventional, and not about whether the value belongs to a third party.

| Category | Naming | Examples |
| --- | --- | --- |
| Only this repository's code reads it | `PUBLIRA_*` | `PUBLIRA_DB_URL`, `PUBLIRA_PUBLIC_API_ADDR`, `PUBLIRA_S3_BUCKET`, `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_REDIS_URL` |
| An external SDK / framework / runtime reads it out of the environment itself | keep the name that software documents | `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` (AWS SDK, `aws` CLI), `NODE_ENV`, `PORT`, `HOST` / `HOSTNAME`, `CI`, `NEXT_PHASE`, `NEXT_PRIVATE_*`, `__NEXT_*`, `OTEL_*` (OpenTelemetry SDK), `PNCH_*` (`@publira/next-cache-handlers`) |

## Names that look like exceptions and are not

- **`S3_*`** were never AWS SDK variables — the development scripts under `scripts/` and `e2e/` read them — so they are `PUBLIRA_S3_BUCKET`, `PUBLIRA_S3_ENDPOINT`, `PUBLIRA_S3_FORCE_PATH_STYLE`, and so on. Only the `AWS_*` credentials and region in the table above are looked up by the SDK and the `aws` CLI.
- **`AUTH_SECRET` is not an Auth.js variable.** This repository does not use Auth.js / NextAuth; the only reader is `resolveAuthSecret()` in `packages/web-session`, which encrypts the session JWE with `jose`. Hence `PUBLIRA_AUTH_SECRET`.
- **`NEXT_*` is not a blanket exception.** Next.js itself reads `NEXT_PHASE`, `NEXT_PRIVATE_DEBUG_CACHE`, and `__NEXT_DEV_SERVER`. The cache variables are not among them: `@publira/next-cache-handlers` is a package of its own that looks up `PNCH_*` itself, and the token the Go server sends to each app's `/api/v1/revalidate` is the server's `PUBLIRA_REVALIDATE_TOKEN`. A `NEXT_` prefix on either would only make it look like a framework setting.
- **A test-harness knob is not outside the rule.** The E2E lifecycle's own variables are read by `e2e/scripts/*` and by nothing else — Playwright looks up `PLAYWRIGHT_*` and `CI`, Compose looks up `COMPOSE_PROJECT_NAME`, and `e2e/compose.yaml` interpolating a name this repository chose is substitution, not a lookup Compose performs of its own. They are therefore `PUBLIRA_E2E_*`, keeping the `E2E_` segment so they do not read as production settings beside the runtime variables an app consumes.
- **A de-facto generic name is not a vendor name.** Nothing looks up `REDIS_URL` by itself: the Go server hands the URL to its Redis client explicitly, and `@publira/next-cache-handlers` reads `PNCH_REDIS_URL`. The server's variable is therefore `PUBLIRA_REDIS_URL`, the same category as `PUBLIRA_DB_URL`, and a web app sharing that Redis is given the same value as `PNCH_REDIS_URL`.

## Adding a variable

`turbo.jsonc`'s `dev` task declares `"passThroughEnv": ["PUBLIRA_*"]`, and turbo defaults to strict env mode. A conforming name reaches the dev servers with no further edit; a non-conforming one needs a hand-written exception in `turbo.jsonc`, `.devcontainer/compose.yaml`, `e2e/scripts/*`, `e2e/bootstrap/scripts/*`, and CI — and wherever that exception is missed, the variable silently does nothing while everything still starts.

- **Do not add an entry to `passThroughEnv`** to make a non-`PUBLIRA_*` name reach an app. Rename the variable.
- Add the variable to the owning README (`server/README.md`, `server/cmd/*/README.md`, `apps/*/README.md`, `packages/*/README.md`) in the same change.
- The current inventory is `git grep -o 'os\.Getenv("[A-Z0-9_]*")' -- server` and `git grep -oE 'process\.env\.[A-Z0-9_]+' -- apps packages`.
