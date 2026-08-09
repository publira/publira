"use client";

import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { ErrorScreen } from "#components/error-screen";

/**
 * Error boundary for the platform console pages. It wraps the pages and nested
 * layouts under `(protected)` but not `(protected)/layout.tsx` itself, so the
 * sidebar and header keep rendering here; a failure raised while rendering that
 * layout — `PlatformUser` / `getPlatformCurrentOperator()` — falls through to
 * `app/error.tsx`.
 *
 * ## Which boundary takes an unclassifiable RPC error
 *
 * This one, for everything a page reads. The lib layer already decides what
 * never gets this far: `rethrowUnclassifiedRpcError()` re-throws `internal` /
 * `unimplemented` and any non-RPC throw, while classified failures become
 * either a message the screen renders inline (`ok: false`) or a `null` the page
 * turns into `notFound()`. So the throws that land here are exactly the ones no
 * copy in `rpcErrorMessage`'s table describes, and 「時間をおいて再試行してく
 * ださい。」 with a digest is the honest answer for them.
 *
 * The two neighbours stay where they are. Failures a form can act on — invalid
 * input, conflicts — remain inline `FormMessage`s next to the control, and the
 * list screens keep rendering their `ok: false` message inside the page rather
 * than replacing it (moving those to `catchError` is #647).
 *
 * No `<main>` here: `ConsoleLayoutMain` already provides one.
 *
 * The response status stays 200 for the same reason a `notFound()` does — see
 * `not-found.tsx`.
 */
const ConsoleError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  <ErrorScreen
    actions={
      <LinkButton render={<Link href="/" />} variant="outline">
        ダッシュボードへ戻る
      </LinkButton>
    }
    description="時間をおいて再試行してください。繰り返す場合は、エラー ID を添えて管理者に連絡してください。"
    digest={error.digest}
    retry={retry}
    title="画面を表示できませんでした"
  />
);

export default ConsoleError;
