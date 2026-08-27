"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

/**
 * The `catchError` half of `<SectionErrorBoundary>`. It is split out because
 * the copy the boundary owns comes from `<Message>`, an async Server
 * Component, which a `"use client"` module cannot render — the server half in
 * `section-error-boundary.tsx` resolves it and passes the nodes down.
 *
 * The `catchError` call stays in the app rather than in
 * `@publira/ui-components` because that package is bundled by `tsdown`, which
 * drops the `"use client"` directive; a boundary exported from there would be
 * evaluated in the server graph. The fallback body and the rationale for the
 * split live in `@publira/ui-components/section-error`.
 */
export const SectionErrorCatch = catchError(sectionErrorFallback);
