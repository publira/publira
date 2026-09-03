# email-templates

The shared React Email layout and templates. `renderEmail` turns them into HTML and text; sending over SMTP is the Go side's job.

`apps/email-renderer` passes the input of the `RenderEmail` RPC to this package.

## What it provides

- `EmailLayout` / `EmailButton`
- `sample` — for checking the layout
- `tenant_admin_invitation` — the tenant admin invitation, the first business template
- `resolveEmail` / `renderEmail` — validate the proto's `template` and `data`, then render
- `loadEmailMessages` — `import()` one locale out of the repo-root `locales/`

Template IDs and variable names are snake_case. The copy lives under `email.*` in the repo-root `locales/*.json`, and rendering takes the catalog, the locale, and the time zone as arguments — the package embeds no copy of its own and reads no environment. `timeZone` is an IANA name, and the invitation's `expires_at` (RFC3339) is displayed in that zone.

`resolveEmail` and `renderEmail` answer `{ ok: false, reason }` rather than throwing; `src/registry.test.ts` is the specification of what each `reason` means.

The caller needs `Temporal`. The tests load `temporal-polyfill/global`, and `email-renderer` should load the same polyfill at process start.

## Usage

```ts
import { loadEmailMessages, renderEmail } from "@publira/email-templates";

const locale = "ja";
const result = await renderEmail({
  template: "tenant_admin_invitation",
  locale,
  timeZone: "Asia/Tokyo",
  messages: await loadEmailMessages(locale),
  data: {
    invite_url: "https://admin.example.com/accept-invite?token=…",
    tenant_name: "青灯書房",
    expires_at: "2030-01-15T12:00:00Z",
  },
});

if (!result.ok) {
  // reason: "unknown_template" | "invalid_data" | "unsupported_locale"
  throw new Error(result.message);
}

result.subject;
result.html;
result.text;
```

## Build

```bash
pnpm --filter @publira/email-templates build
```

`react` and `react-dom` are `dependencies`, not `peerDependencies`: the built `dist/` leaves `react/jsx-runtime` and `react-email` as external imports, and they have to resolve in a production tree assembled with `pnpm install --prod` alone (`infra/docker/node/Dockerfile`).
