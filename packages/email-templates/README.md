# email-templates

The shared React Email layout and templates. `renderEmail` turns them into HTML; the subject line and the plain-text alternative of the same mail are composed from the same catalogs by the Go server, which is also what sends it over SMTP.

`apps/email-renderer` passes the input of the `RenderEmail` RPC to this package.

## What it provides

- `EmailLayout` / `EmailButton`, and the blocks a template puts inside the card: `EmailHeading`, `EmailIntro`, `EmailBody`, `EmailDetail`, `EmailMeta`, `EmailFallbackLink`, `EmailLetter`, `EmailQuote`
- `resolveEmail` / `renderEmail` — validate the proto's `template` and `data`, then render
- `TEMPLATE_IDS` / `isTemplateId` — the list of template IDs, and whether a string is one of them
- `loadEmailMessages` — `import()` one locale out of the repo-root `locales/`, bound to that locale
- `emailMessage` — one string out of a loaded catalog, formatted with its placeholders in the catalog's locale

A template is reached by ID rather than imported; `TEMPLATE_IDS` is the whole list.

| Template | Mail | `data` |
| --- | --- | --- |
| `tenant_admin_invitation` | invitation to hold a console role | `tenant_name`, `invite_url`, `role`, `expires_at` |
| `reader_email_verification` | sign-up address verification | `tenant_name`, `verify_url`, `expires_at` |
| `reader_email_change_confirmation` | address change, to the current and to the new address | `tenant_name`, `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `reader_email_changed_notice` | to the previous address once the change completes | `tenant_name`, `previous_email`, `new_email` |
| `reader_password_reset` | reader password reset | `tenant_name`, `reset_url`, `expires_at` |
| `reader_password_changed_notice` | to a reader whose password was changed | `tenant_name`, `email`, `reset_url` |
| `reader_signup_attempt_notice` | to an address a sign-up tried to reuse | `tenant_name`, `email`, `account_state`, `action_url` |
| `admin_console_email_change_confirmation` | admin console address change | `tenant_name`, `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `admin_console_email_changed_notice` | admin console, to the previous address | `tenant_name`, `previous_email`, `new_email` |
| `admin_console_password_reset` | admin console password reset | `tenant_name`, `reset_url`, `expires_at` |
| `platform_console_email_change_confirmation` | platform console address change | `confirm_url`, `recipient_kind`, `current_email`, `new_email`, `expires_at` |
| `platform_console_email_changed_notice` | platform console, to the previous address | `previous_email`, `new_email` |
| `platform_console_operator_added` | to an operator a Super admin added, with the link that sets the new account's first password | `set_password_url`, `expires_at` |
| `platform_console_operator_role_granted` | to an existing platform account a Super admin gave a role, with no password link | `sign_in_url` |
| `platform_console_password_reset` | platform console password reset | `reset_url`, `expires_at` |
| `staff_contact_message_notice` | to the tenant's staff, when a reader sends a message through the contact form | `tenant_name`, `sender_name`, `reply_to_email`, `subject`, `body`, `received_at` |
| `staff_contact_reply` | to a reader, with the answer a member of staff wrote in the console | `tenant_name`, `body`, `original_subject`, `original_body`, `original_received_at` |
| `purchase_receipt` | to a reader, for an episode they bought on the site | `tenant_name`, `series_title`, `episode_title`, `amount`, `currency`, `purchased_at`, `expires_at`, `is_test`, `library_url` |
| `purchase_refund_notice` | to a reader, whatever their email cells say, when a refund the payment provider made on their purchase is recorded | `tenant_name`, `series_title`, `episode_title`, `volume_title`, `series_bundle_episode_count`, `coin_pack_coins`, `coin_pack_bonus_coins`, `coin_name`, `is_tip`, `amount`, `refunded_total`, `price`, `currency`, `closed`, `is_test`, `library_url` |
| `subscription_started` | to a reader, whatever their email cells say, when the first invoice of a subscription they took out on the site is paid | `tenant_name`, `plan_name`, `amount`, `currency`, `period_start`, `period_end`, `is_test`, `my_page_url` |
| `subscription_renewed` | to a reader, whatever their email cells say, when an invoice of a subscription they took out on the site is paid for a new period after the first | `tenant_name`, `plan_name`, `amount`, `currency`, `period_start`, `period_end`, `is_test`, `my_page_url` |
| `subscription_payment_failed` | to a reader, whatever their email cells say, when an attempt to collect an invoice of a subscription they took out on the site does not go through while the subscription still opens its plan's episodes | `tenant_name`, `plan_name`, `amount`, `currency`, `next_attempt`, `period_end`, `is_test`, `my_page_url` |
| `subscription_ended` | to a reader, whatever their email cells say, when a subscription they took out on the site and were billed for ends, whoever ended it | `tenant_name`, `plan_name`, `ended_at`, `plans_url` |
| `reader_episode_published` | to a reader whose email cell is on, for an episode of a series or by an author they follow | `tenant_name`, `series_title`, `episode_title`, `episode_url`, `settings_url` |
| `reader_announcement_posted` | to a reader whose email cell is on, or to every reader, for an announcement the tenant posted | `tenant_name`, `announcement_title`, `announcements_url`, `sent_to_everyone`, `settings_url` |
| `reader_comment_approved` | to a reader whose email cell is on, when staff approve their comment | `tenant_name`, `series_title`, `episode_title`, `episode_url`, `settings_url` |
| `reader_data_export_ready` | to a reader, whatever their email cells say, when the archive of their data they asked for is ready | `tenant_name`, `expires_at`, `settings_url` |

Template IDs and variable names are snake_case. The copy lives under `email.*` in the repo-root `locales/*.json`, and rendering takes the catalog, the locale, and the time zone as arguments — the package embeds no copy of its own and reads no environment. `timeZone` is an IANA name, and every `expires_at` (RFC3339) is displayed in that zone.

`tenant_name` is who the mail is from. `EmailLayout` shows it as the sender above the card and repeats it in the footer: a reader signed up on the tenant's site and never met the platform, so a mail a tenant owns is branded with the tenant throughout. The platform console's mails take no `tenant_name` because they belong to no tenant, and are the only ones that say Publira.

`role` is the console role the invitation grants — `tenant_admin`, `tenant_editor`, or `tenant_auditor` — and the copy names it.

`recipient_kind` is `current_email` or `new_email` — both sides of an address change confirm, and the sender says which side it is addressing.

`amount` is the price paid, an integer in the minor unit of `currency` (an ISO 4217 code), and is written with `formatPrice` from `@publira/utils`. `expires_at` is the empty string for a purchase with no reading period, and the line naming it is then left out. `is_test` is `true` for a purchase paid in the payment provider's test mode, and the mail then says no money was charged.

In `purchase_refund_notice`, `amount` is what this refund returned, `refunded_total` what every refund of the purchase adds up to with it, and `price` the price paid, all in the minor unit of `currency`; the total is stated only once it differs from `amount`. `closed` is `true` once the refunds reach the price, and the mail then says what the purchase opened is closed, or that a pack's remaining coins were taken back; a tip's mail says nothing of either.

In `subscription_started` and `subscription_renewed`, `amount` is what the invoice paid, the first one or a later one, in the minor unit of `currency`, and `period_start` and `period_end` (RFC3339) bound the period it paid for; the mail says the plan's episodes are open until `period_end` and the plan renews then. `my_page_url` is My Page on the site, where **Manage billing** opens the payment provider's billing page.

In `subscription_payment_failed`, `amount` is what the invoice asks for, in the minor unit of `currency`, `next_attempt` (RFC3339) when the payment provider tries again, or empty when its notification named no such time, in which case the mail says nothing of the retries, and `period_end` (RFC3339) the end of the subscription's current period; the mail says the plan's episodes stay open until `period_end` at the latest, and sends the reader to `my_page_url` to update their payment method.

In `subscription_ended`, `ended_at` (RFC3339) is when the payment provider ended the subscription, which the mail gives as the day it ended and the plan's episodes with it, and `plans_url` is the site's subscription plans page, where the reader may subscribe again.

`settings_url` is the reader's notification settings on the site, where they choose which of these mails they receive. `sent_to_everyone` is `true` for an announcement the tenant sent to every reader whatever their settings; the mail then says so and takes no `settings_url`.

`account_state` is `confirmed` or `unconfirmed`, and it picks both the copy and what `action_url` is expected to point at: the reset form for an account that can be signed into, the resend form for one whose address is still waiting to be confirmed.

`resolveEmail` and `renderEmail` answer `{ ok: false, reason }` rather than throwing; `src/registry.test.ts` is the specification of what each `reason` means.

## Usage

```ts
import { loadEmailMessages, renderEmail } from "@publira/email-templates";

const locale = "ja";
const result = await renderEmail({
  template: "tenant_admin_invitation",
  locale,
  timeZone: "UTC",
  messages: await loadEmailMessages(locale),
  data: {
    invite_url: "https://admin.example.com/accept-invite?token=…",
    role: "tenant_editor",
    tenant_name: "Aoto Press",
    expires_at: "2030-01-15T12:00:00Z",
  },
});

if (!result.ok) {
  // reason: "unknown_template" | "invalid_data" | "unsupported_locale"
  throw new Error(result.message);
}

result.html;
```

## Build

```bash
pnpm build --filter @publira/email-templates
```

`react` and `react-dom` are `dependencies`, not `peerDependencies`: the built `dist/` leaves `react/jsx-runtime` and `react-email` as external imports, and they have to resolve in a production tree assembled with `pnpm install --prod` alone (`infra/docker/node/Dockerfile`).
