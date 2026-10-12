"use client";

import { redirect, usePathname, useSearchParams } from "next/navigation";

import { legalPageAgreementRedirect } from "#lib/legal-page-agreement-path";

/**
 * Sends a reader who owes an agreement to the screen that asks for it, from
 * whichever page they are on, so they come back to it once they agree.
 *
 * The path is the browser's, which only the client knows: a Server Component
 * is not told the URL it renders for. `redirect()` during a server render is a
 * redirect of the response, and during a client render a navigation, so a
 * reader who leaves one of the pages they were asked to read for another one
 * is sent back as well.
 */
export const LegalPageAgreementRedirect = ({
  agreementPath,
  exemptPaths,
}: {
  agreementPath: string;
  exemptPaths: readonly string[];
}) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const target = legalPageAgreementRedirect({
    agreementPath,
    exemptPaths,
    pathname,
    search: searchParams.toString(),
  });
  if (target) {
    redirect(target);
  }

  return null;
};
