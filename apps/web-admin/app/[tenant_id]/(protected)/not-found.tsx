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
 * header. URLs that match no route at all are handled by
 * `app/global-not-found.tsx` (#646), not this boundary.
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
 * The response status stays 200, and that is the specified behaviour, not a
 * defect awaiting repair. Under Cache Components the static shell — sidebar,
 * header, skeletons — is prerendered and committed before any dynamic data is
 * read, so a `notFound()` raised while resolving the resource cannot change the
 * status: this UI arrives in the flight payload and paints after hydration
 * rather than in the SSR `<body>`. Do not "fix" it by hoisting the fetch to an
 * outer boundary. Truly unmatched URLs use `app/global-not-found.tsx` and are
 * a separate path, not a later fix for this status behaviour.
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
