"use server";

import { persistLocaleChoice } from "@publira/locale/locale-cookie";

import { assertSameOrigin } from "./csrf";

/**
 * Persist the chosen UI locale.
 *
 * The screen this Action re-renders in its own round trip was routed onto the
 * `[locale]` segment the old cookie named, so it is still in the old language;
 * `PlatformLocaleSwitcherRoot` refreshes the route once this settles, which
 * sends it through `proxy.ts` on the new cookie. Nothing here needs to
 * revalidate: no cache entry depends on the cookie. `<html lang>` is the one
 * thing neither render touches — it is written by the `<head>` script — so the
 * switcher sets that attribute in its own handler.
 *
 * An unknown value is dropped rather than reported. The switcher offers exactly
 * the supported locales, so the only way to submit anything else is a forged
 * request, and there is no form state to show a message in.
 */
export const setPlatformLocaleAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  await persistLocaleChoice(formData);
};
