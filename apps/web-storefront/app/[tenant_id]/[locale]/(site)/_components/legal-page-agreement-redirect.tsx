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
 *
 * Each read decides only the page it was made for, and only while the layout
 * is shown. Next.js keeps the layout of a page the reader left rendered in a
 * hidden `<Activity>`, where it renders again for the URL the reader is on now
 * — the agreement screen, among others — and a `redirect()` thrown there is
 * carried out when the reader comes back, after they may have agreed.
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
  const page = `${pathname}?${search}`;
  // The page the server's read is about, which this instance mounted on.
  // oxlint-disable-next-line react/hook-use-state -- it never changes, and a ref cannot be read during render
  const [renderedPage] = useState(page);
  // The page the server was last asked about, which needs no second read.
  const checkedPage = useRef(page);
  // What the server answered after the last client-side navigation, for the
  // page it was asked about. It is read during render, where `redirect()` has
  // to be called: Next.js does not take one from an Effect.
  // oxlint-disable-next-line react-doctor/rerender-state-only-in-handlers -- the answer decides the redirect() the render makes
  const [answer, setAnswer] = useState<{
    exemptPaths: string[] | null;
    page: string;
  } | null>(null);

  useEffect(() => {
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
    // The answer goes with the Effect that asked for it. Hiding the layout runs
    // this too, so the reader who comes back after agreeing is not sent to
    // agree again on an answer from before.
    return () => {
      current = false;
      setAnswer(null);
    };
  }, [check, page]);

  // A page no read is about yet waits for the answer `check` gives for it.
  let owed: readonly string[] | null = null;
  if (answer?.page === page) {
    owed = answer.exemptPaths;
  } else if (page === renderedPage) {
    owed = exemptPaths;
  }
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
