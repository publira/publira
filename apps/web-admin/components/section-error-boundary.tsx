"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

/**
 * Section-level error boundary for the admin console (#647). Wrap a section's
 * `<Suspense>` with it, so `retry()` puts that section's own skeleton back
 * while the re-run is in flight. The fallback body and the rationale for this
 * split live in `@publira/ui-components/section-error`.
 *
 * The four strings it shows are nodes the page passes in; spread
 * `sectionErrorCopy()` onto it rather than writing them out at each boundary.
 *
 * This is the component-level counterpart of `(protected)/error.tsx`: a failure
 * that makes the whole page meaningless still belongs to that one. What reaches
 * either is decided by the same rule as everywhere else in the console — a
 * `catch` may degrade a read it can classify, and
 * `rethrowUnclassifiedRpcError()` re-throws the rest. The difference is reach —
 * an operator loses one card here instead of the whole console page.
 */
export const SectionErrorBoundary = catchError(sectionErrorFallback);
