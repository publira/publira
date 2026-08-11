import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

/**
 * 404 for everything under the signed-in platform console. The tenant /
 * operator / end-user detail routes all reach here through `notFound()` after
 * `getPlatformTenant()` / `getPlatformOperator()` / `getPlatformEndUser()`
 * resolve to nothing, so the copy stays resource-agnostic.
 *
 * Rendered inside `(protected)/layout.tsx`, which keeps the console sidebar and
 * header. URLs that match no route at all are handled by
 * `app/global-not-found.tsx`, not this boundary.
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * ## Why 404 and not 401 / 403
 *
 * Same split as the web-admin console, for the same reasons:
 *
 * - **Not signed in** — `proxy.ts` redirects to `/login` before the route
 *   renders, and `PlatformUser` in `components/platform-layout.tsx` redirects
 *   again when the session no longer resolves to an operator. An operator whose
 *   session expired wants the login form, not a 401 page.
 * - **Signed in, resource not visible** — `isMissingResourceRpcError()`
 *   deliberately merges `not_found` and `permission_denied`. Rendering a
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
 * outer boundary.
 */
const NotFound = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>404 Not Found</PlatformPageEyebrow>
        <PlatformPageTitle>ページが見つかりません</PlatformPageTitle>
        <PlatformPageDescription>
          お探しの項目は削除されたか、URL
          が変更された可能性があります。一覧から選び直してください。
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/" />} variant="outline">
          ダッシュボードへ戻る
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
  </PlatformPage>
);

export default NotFound;
