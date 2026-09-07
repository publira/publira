"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { Button } from "../button/button";
import {
  SectionErrorDigestLine,
  SectionErrorDigestValue,
} from "../section-error/section-error";

/** What the boundary caught, in the two terms a fallback body can use. */
interface SectionErrorState {
  /**
   * `error.digest`, when the failure carries one. A Server Component error
   * reaches the client with its message replaced in production, so the digest
   * is the only handle a reader can quote to match the server log.
   */
  digest: string | undefined;
  /** Re-runs the subtree the boundary wraps. */
  retry: () => void;
}

const SectionErrorStateContext = createContext<SectionErrorState | null>(null);

export interface SectionErrorFallbackProps {
  /**
   * The failure body, built by the app that wired the boundary up so its
   * wording comes from that app's catalog. It is a prop rather than `children`
   * because `children` is the subtree the boundary protects.
   */
  fallback: ReactNode;
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

const SectionErrorFallbackState = ({
  children,
  digest,
  retry,
}: {
  children: ReactNode;
  digest: string | undefined;
  retry: () => void;
}) => {
  const state = useMemo(() => ({ digest, retry }), [digest, retry]);

  return (
    <SectionErrorStateContext value={state}>
      {children}
    </SectionErrorStateContext>
  );
};

/**
 * Section-level error boundary body: a section that throws is replaced by the
 * `fallback` tree, every sibling section keeps whatever it already rendered,
 * and `SectionErrorRetry` re-runs only that subtree.
 *
 * Pass it to `catchError` from a module that is already in the client graph:
 *
 * ```tsx
 * "use client";
 *
 * import { sectionErrorFallback } from "@publira/ui-components/section-error-fallback";
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
  { fallback }: SectionErrorFallbackProps,
  { error, retry }: SectionErrorInfo
) => (
  <SectionErrorFallbackState digest={errorDigest(error)} retry={retry}>
    {fallback}
  </SectionErrorFallbackState>
);

const useSectionErrorState = (): SectionErrorState => {
  const state = useContext(SectionErrorStateContext);
  if (!state) {
    throw new Error(
      "SectionErrorRetry and SectionErrorDigest must be rendered inside a sectionErrorFallback body."
    );
  }
  return state;
};

/**
 * The control that re-runs the section. Its children are its label, so the
 * wording is written where it is rendered; only the callback comes from the
 * boundary.
 */
export const SectionErrorRetry = ({ children }: { children: ReactNode }) => {
  const { retry } = useSectionErrorState();

  return (
    <Button onClick={() => retry()} size="sm" variant="outline">
      {children}
    </Button>
  );
};

/**
 * The digest line. Its children are the prefix that introduces the identifier
 * ("Error ID:"); the identifier itself comes from the error the boundary
 * caught. Nothing is rendered when that error carries no digest, so a reader
 * never meets a dangling prefix.
 */
export const SectionErrorDigest = ({ children }: { children: ReactNode }) => {
  const { digest } = useSectionErrorState();

  if (digest === undefined) {
    return null;
  }

  return (
    <SectionErrorDigestLine>
      {children} <SectionErrorDigestValue>{digest}</SectionErrorDigestValue>
    </SectionErrorDigestLine>
  );
};
