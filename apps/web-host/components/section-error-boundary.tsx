"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

/**
 * Section-level error boundary for the tenant site (#647). Wrap a section's
 * `<Suspense>` with it, so `retry()` puts that section's own skeleton back
 * while the re-run is in flight. The fallback body and the rationale for this
 * split live in `@publira/ui-components/section-error`.
 *
 * This is the component-level counterpart of `(site)/error.tsx`: a failure that
 * makes the whole route meaningless still belongs to that one. Pages used to
 * pick between the two with a `try` / `catch` around each read, which is what
 * this replaces. Retiring those `catch` blocks costs nothing that was working —
 * a throw inside a `"use cache"` scope is not observable from the awaiting
 * caller, so in production they never ran and the route answered a bare 500
 * instead (#672). Whether the throw reaches this boundary instead is measured
 * there, not assumed here.
 */
export const SectionErrorBoundary = catchError(sectionErrorFallback);
