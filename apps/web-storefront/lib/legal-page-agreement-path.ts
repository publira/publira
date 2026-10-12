import { toBarePathname } from "./locale-path";

/**
 * Where a signed-in reader who owes an agreement to the tenant's terms of
 * service or privacy policy agrees to it. It sits under `/settings`, which no
 * published page may take and `proxy.ts` keeps from a browser holding no
 * session, so neither a page nor a guest can stand on it.
 */
export const LEGAL_PAGE_AGREEMENT_PATH = "/settings/agreement";

/**
 * Where a reader who would rather not agree deletes their account. The public
 * API lets a reader who owes an agreement delete it, so the screen has to stay
 * open to them.
 */
export const ACCOUNT_DELETION_PATH = "/settings";

/**
 * The agreement screen's URL, carrying where the reader goes once they agree.
 * `agreementPath` already carries the locale prefix; the screen sanitizes
 * `returnTo` when it reads it, as the sign-in screen does.
 */
export const legalPageAgreementHref = (
  agreementPath: string,
  returnTo: string
): string => `${agreementPath}?${new URLSearchParams({ returnTo }).toString()}`;

/**
 * Where a reader who owes an agreement is sent from `pathname`, or `null` on a
 * path they are left on: one of the pages they are asked to read, which the
 * agreement screen opens in a tab of their own, and the screen that deletes
 * the account.
 *
 * `pathname` is what `usePathname()` reports, in either the rewritten or the
 * public shape, and `exemptPaths` are bare paths.
 */
export const legalPageAgreementRedirect = ({
  agreementPath,
  exemptPaths,
  pathname,
  search,
}: {
  agreementPath: string;
  exemptPaths: readonly string[];
  pathname: string;
  search: string;
}): string | null => {
  const barePathname = toBarePathname(pathname);
  if (exemptPaths.includes(barePathname)) {
    return null;
  }

  return legalPageAgreementHref(
    agreementPath,
    search ? `${barePathname}?${search}` : barePathname
  );
};
