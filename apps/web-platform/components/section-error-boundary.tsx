"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

/**
 * Section-level error boundary for the platform console (#647). Wrap a
 * section's `<Suspense>` with it, so `retry()` puts that section's own skeleton
 * back while the re-run is in flight. The fallback body and the rationale for
 * this split live in `@publira/ui-components/section-error`.
 *
 * This is the component-level counterpart of `(protected)/error.tsx`, and it
 * takes the same throws that one does: the lib layer classifies what it can
 * (`ok: false` with a message the screen renders through `SectionError`) and
 * `rethrowUnclassifiedRpcError()` re-throws the rest. The difference is reach —
 * an operator loses one card here instead of the whole console page.
 */
export const SectionErrorBoundary = catchError(sectionErrorFallback);
