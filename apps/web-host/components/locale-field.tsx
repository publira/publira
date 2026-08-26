"use client";

import { LOCALE_FIELD_NAME } from "#lib/locale-form";

import { useLocale } from "./locale-provider";

/**
 * Hidden field that carries the reader's locale into a Server Action.
 *
 * Actions cannot read `next/root-params`, so a form that redirects — to
 * `/login` after a rejected session, or back to the page it was submitted
 * from — has to be told which locale to redirect within. The value comes from
 * the route tree rather than the URL, so it is the same before and after
 * hydration.
 *
 * A Server Component renders this too: it is the locale equivalent of the
 * `tenantId` field the same forms already carry.
 */
export const LocaleField = () => {
  const locale = useLocale();

  return <input name={LOCALE_FIELD_NAME} type="hidden" value={locale} />;
};
