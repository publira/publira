# email-templates

The shared React Email layout and templates. `renderEmail` turns them into HTML and text; sending over SMTP is the Go side's job.

`apps/email-renderer` passes the input of the `RenderEmail` RPC to this package.

## What it provides

- `EmailLayout` / `EmailButton`, and the blocks a template puts inside the card: `EmailHeading`, `EmailIntro`, `EmailBody`, `EmailDetail`, `EmailMeta`, `EmailFallbackLink`
- `resolveEmail` / `renderEmail` — validate the proto's `template` and `data`, then render
- `loadEmailMessages` — `import()` one locale out of the repo-root `locales/`

A template is reached by ID rather than imported; `TEMPLATE_IDS` is the whole list.

| Template | Mail | `data` |
| --- | --- | --- |
| `sample` | for checking the layout | `title`, `body`, `action_label`, `action_url` |
| `tenant_admin_invitation` | tenant admin invitation | `tenant_name`, `invite_url`, `expires_at` |
| `reader_email_verification` | sign-up address verification | `tenant_name`, `verify_url`, `expires_at` |
| `reader_email_change_confirmation` | address change, to the current and to the new address | `tenant_name`, `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `reader_email_changed_notice` | to the previous address once the change completes | `tenant_name`, `previous_email`, `new_email` |
| `reader_password_reset` | reader password reset | `tenant_name`, `reset_url`, `expires_at` |
| `admin_console_email_change_confirmation` | admin console address change | `tenant_name`, `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `admin_console_email_changed_notice` | admin console, to the previous address | `tenant_name`, `previous_email`, `new_email` |
| `admin_console_password_reset` | admin console password reset | `tenant_name`, `reset_url`, `expires_at` |
| `platform_console_email_change_confirmation` | platform console address change | `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `platform_console_email_changed_notice` | platform console, to the previous address | `previous_email`, `new_email` |
| `platform_console_password_reset` | platform console password reset | `reset_url`, `expires_at` |

Template IDs and variable names are snake_case. The copy lives under `email.*` in the repo-root `locales/*.json`, and rendering takes the catalog, the locale, and the time zone as arguments — the package embeds no copy of its own and reads no environment. `timeZone` is an IANA name, and every `expires_at` (RFC3339) is displayed in that zone.

`tenant_name` is who the mail is from. It opens the subject line, and `EmailLayout` shows it as the sender above the card and repeats it in the footer: a reader signed up on the tenant's site and never met the platform, so a mail a tenant owns is branded with the tenant throughout. The platform console's mails take no `tenant_name` because they belong to no tenant — those, and `sample`, are the only ones that say Publira.

`recipient_kind` is `current_email` or `new_email` — both sides of an address change confirm, and the sender says which side it is addressing.

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
    tenant_name: "Aoto Press",
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
