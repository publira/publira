"use client";

import type { ReactNode } from "react";

import { Button } from "../button/button";
import { SectionError } from "./section-error";

/**
 * Every field is required. This package holds no copy, so a boundary that left
 * one out would have nothing to render but a fixed language; the app that wires
 * the boundary up is the one that can resolve all four from its own catalog.
 */
export interface SectionErrorFallbackProps {
  /** What the reader can do about it. */
  description: ReactNode;
  /** Prefix shown before the digest, such as "Error ID:". */
  digestLabel: ReactNode;
  /** Label of the button that re-runs the section. */
  retryLabel: ReactNode;
  /** Names the section that is missing: "Could not display the recommendations". */
  title: ReactNode;
}

/**
 * The subset of `next/error`'s `ErrorInfo` this fallback reads.
 *
 * Spelled structurally rather than imported so this package keeps no
 * dependency on `next` — `catchError` passes the full `ErrorInfo`, which
 * satisfies this.
 */
interface SectionErrorInfo {
  error: unknown;
  retry: () => void;
}

/**
 * `ErrorInfo["error"]` is `unknown`, and a Server Component error reaches the
 * client with its message replaced in production. The digest is the one field
 * worth reading either way.
 */
const errorDigest = (error: unknown): string | undefined => {
  if (error instanceof Error && "digest" in error) {
    const { digest } = error;
    if (typeof digest === "string") {
      return digest;
    }
  }
  return undefined;
};

/**
 * Shared body of every app's section-level error boundary: a section
 * that throws is replaced by a `SectionError` naming it, every sibling section
 * keeps whatever it already rendered, and the retry button re-runs only that
 * subtree.
 *
 * Pass it to `catchError` from a module that is already in the client graph:
 *
 * ```tsx
 * "use client";
 *
 * import { sectionErrorFallback } from "@publira/ui-components/section-error";
 * import { catchError } from "next/error";
 *
 * export const SectionErrorCatch = catchError(sectionErrorFallback);
 * ```
 *
 * The `catchError` call stays in each app because this package is built with
 * `tsdown`, which drops the `"use client"` directive when it bundles — so a
 * boundary exported from here would be evaluated in the server graph, which is
 * exactly where `catchError` cannot run. Each app's `components/` file is
 * compiled by Next.js from source and keeps its directive. That is the same
 * split the route-level `error.tsx` bodies already use.
 *
 * `catchError` rather than a hand-written React error boundary because it knows
 * about the framework: `redirect()` and `notFound()` throw to signal
 * themselves and must not be caught, and the error state has to clear on a
 * client navigation to another route.
 *
 * `retry()` rather than `reset()`, for the reason the route-level boundaries
 * give: `reset()` only clears the error state, so it cannot recover from a
 * Server Component failure.
 */
export const sectionErrorFallback = (
  { description, digestLabel, retryLabel, title }: SectionErrorFallbackProps,
  { error, retry }: SectionErrorInfo
) => {
  const digest = errorDigest(error);

  return (
    <SectionError
      actions={
        <Button onClick={() => retry()} size="sm" variant="outline">
          {retryLabel}
        </Button>
      }
      description={description}
      digest={
        digest === undefined ? undefined : { label: digestLabel, value: digest }
      }
      title={title}
    />
  );
};
