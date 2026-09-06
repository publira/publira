"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error-fallback";
import { catchError } from "next/error";

/**
 * The `catchError` half of `<SectionErrorBoundary>`. It is split out because
 * the copy the boundary owns comes from `<Message>`, an async Server
 * Component, which a `"use client"` module cannot render — the server half in
 * `section-error-boundary.tsx` resolves it and passes the tree down.
 *
 * The `catchError` call stays in the app rather than in
 * `@publira/ui-components` because that package is bundled by `tsdown`, which
 * drops the `"use client"` directive; a boundary exported from there would be
 * evaluated in the server graph. `SectionErrorDigest` and `SectionErrorRetry`
 * read what the boundary caught through a context, so they are re-exported here
 * for the same reason. The fallback body and the rationale for the split live
 * in `@publira/ui-components/section-error-fallback`, which is a subpath of
 * its own so a Server Component rendering a plain `SectionError` never pulls
 * that context into the server graph.
 */
export const SectionErrorCatch = catchError(sectionErrorFallback);

export {
  SectionErrorDigest,
  SectionErrorRetry,
} from "@publira/ui-components/section-error-fallback";
