"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { legalPageAgreementRedirect } from "#lib/legal-page-agreement-path";

/**
 * Sends a reader who owes an agreement to the screen that asks for it, from
 * whichever page they are on, so they come back to it once they agree.
 *
 * The path is the browser's, which only the client knows: a Server Component
 * is not told the URL it renders for. `exemptPaths` is what the server read
 * for the page the layout was rendered on, and `redirect()` during that render
 * is a redirect of the response. A client-side navigation keeps the layout, so
 * after one the server is asked again through `check`: a revision published
 * while the reader was browsing is asked about on the next page they open, not
 * on the next reload.
 */
export const LegalPageAgreementRedirect = ({
  agreementPath,
  check,
  exemptPaths,
}: {
  agreementPath: string;
  check: () => Promise<string[] | null>;
  exemptPaths: readonly string[] | null;
}) => {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // The page the server already answered for, which needs no second read.
  const checkedPage = useRef(`${pathname}?${search}`);
  // What the server answered after the last client-side navigation, for the
  // page it was asked about. It is read during render, where `redirect()` has
  // to be called: Next.js does not take one from an Effect.
  // oxlint-disable-next-line react-doctor/rerender-state-only-in-handlers -- the answer decides the redirect() the render makes
  const [answer, setAnswer] = useState<{
    exemptPaths: string[] | null;
    page: string;
  } | null>(null);

  useEffect(() => {
    const page = `${pathname}?${search}`;
    if (page === checkedPage.current) {
      return;
    }
    checkedPage.current = page;

    let current = true;
    const ask = async () => {
      try {
        const owed = await check();
        if (current) {
          setAnswer({ exemptPaths: owed, page });
        }
      } catch {
        // An unreachable server asks nothing; the API still refuses.
      }
    };
    ask();
    return () => {
      current = false;
    };
  }, [check, pathname, search]);

  // An answer is about the page it was asked for; until the one for this page
  // arrives, the server's own read stands.
  const owed =
    answer?.page === `${pathname}?${search}` ? answer.exemptPaths : exemptPaths;
  const target = owed
    ? legalPageAgreementRedirect({
        agreementPath,
        exemptPaths: owed,
        pathname,
        search,
      })
    : null;
  if (target) {
    redirect(target);
  }

  return null;
};
