# apps

The web frontends. Turborepo manages one Next.js app per host.

## Apps

| App | Port | Purpose |
| --- | --- | --- |
| `web-host/` | 3000 | Public tenant site (catalog, authentication, member pages, static public pages) |
| `web-admin/` | 4000 | Content entry and operations console for publishers and editors |
| `web-platform/` | 4100 | Cross-tenant operations console for platform operators |
| `email-renderer/` | 8080 | ConnectRPC service that renders React Email templates into HTML and text |

## Development commands

```bash
# Start every app, including email-renderer (Turbo runs each app's dev script)
pnpm dev

# Start every app together with the Go server
task dev

# Start one app
cd apps/web-host     && pnpm dev
cd apps/web-admin    && pnpm dev
cd apps/web-platform && pnpm dev
cd apps/email-renderer && pnpm dev
```

With a worktree profile, run `eval "$(task --silent dev-env:env)"` before the usual command. `pnpm dev` of `web-host`, `web-admin`, and `web-platform` honors `PORT`, so each one listens on the port the profile assigned.
