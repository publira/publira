"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

import { ClientMessage } from "#components/client-message";
import type { AdminMessageKey } from "#lib/messages";

/**
 * The subset of `next/error`'s `ErrorInfo` the fallback reads, spelled
 * structurally the way `@publira/ui-components` spells it.
 */
interface SectionErrorInfo {
  error: unknown;
  retry: () => void;
}

/**
 * Only the title differs between sections, and it arrives as a catalog key —
 * `@publira/ui-components` defaults the other three strings to Japanese, so a
 * boundary that left them alone would read as Japanese on an English page.
 */
const adminSectionErrorFallback = (
  { title }: { title: AdminMessageKey },
  info: SectionErrorInfo
) =>
  sectionErrorFallback(
    {
      description: <ClientMessage message="admin.common.retry_later" />,
      digestLabel: <ClientMessage message="admin.common.error_id" />,
      retryLabel: <ClientMessage message="admin.common.retry" />,
      title: <ClientMessage message={title} />,
    },
    info
  );

/**
 * Section-level error boundary for the admin console (#647). Wrap a section's
 * `<Suspense>` with it, so `retry()` puts that section's own skeleton back
 * while the re-run is in flight. The fallback body and the rationale for this
 * split live in `@publira/ui-components/section-error`.
 *
 * This is the component-level counterpart of `(protected)/error.tsx`, and it
 * takes the same throws that one does: the lib layer classifies what it can
 * (`ok: false` with a message the screen renders through `SectionError`) and
 * `rethrowUnclassifiedRpcError()` re-throws the rest. The difference is reach —
 * an operator loses one card here instead of the whole console page.
 */
export const SectionErrorBoundary = catchError(adminSectionErrorFallback);
