import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import {
  AdminPage,
  AdminPageActions,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";

/**
 * 404 for everything under the signed-in console. `getTenantId()` and the
 * series / label / creator / page edit routes all reach here through
 * `notFound()`, so the copy stays resource-agnostic.
 *
 * Rendered inside `(protected)/layout.tsx`, which keeps the console sidebar and
 * header. Unmatched URLs that never resolve to a tenant are #646, not this
 * boundary.
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * ## Why 404 and not 401 / 403
 *
 * The three "you cannot see this" cases are deliberately split by *who* answers
 * them, and only one of them lands here:
 *
 * - **Not signed in** — `proxy.ts` redirects to `/login` before the route
 *   renders, and `(protected)/layout.tsx` redirects again when the session no
 *   longer resolves to a tenant user. An operator whose session expired wants
 *   the login form, not a 401 page.
 * - **Signed in, resource not visible** — the server answers `not_found` and
 *   `permission_denied` for another tenant's rows, and
 *   `isMissingResourceRpcError()` deliberately merges the two. Rendering a
 *   distinct 403 would undo that: it would confirm the record exists, which is
 *   exactly what the merge exists to hide. So both become this 404.
 * - **Signed in, insufficient role for an action** — stays a per-form message
 *   next to the control the operator tried to use; a whole-page interrupt would
 *   lose the context of what was rejected.
 *
 * `forbidden()` / `unauthorized()` are therefore not adopted. They also still
 * require the experimental `authInterrupts` flag, but the reason above holds
 * regardless of when that flag stabilises.
 *
 * Known limitation, measured against `next dev`: `(protected)/layout.tsx` wraps
 * the page in `<Suspense>`, so the shell — sidebar, header, skeletons — is
 * flushed with HTTP 200 before any page data is read. By the time `notFound()`
 * runs the status is already committed, and this UI arrives in the flight
 * payload and paints after hydration rather than in the SSR `<body>`. Hoisting
 * the fetch out of the page's own `<Suspense>` would not change that; the
 * boundary that commits the response lives in the layout. The console is behind
 * a login, so no crawler observes the status; composing the 404 above the
 * tenant layout is #646.
 */
const NotFound = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>404 Not Found</AdminPageEyebrow>
        <AdminPageTitle>ページが見つかりません</AdminPageTitle>
        <AdminPageDescription>
          お探しの項目は削除されたか、URL
          が変更された可能性があります。一覧から選び直してください。
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/" />} variant="outline">
          ダッシュボードへ戻る
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
  </AdminPage>
);

export default NotFound;
