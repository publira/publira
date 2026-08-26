"use server";

import { getLocales, LOCALE_COOKIE_NAME } from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { cookies } from "next/headers";
import { z } from "zod";

import { adminLocaleCookieOptions } from "./locale";
import { LOCALE_FIELD_NAME } from "./locale-shared";

const localeFormSchema = z.object({
  locale: z.enum(getLocales()),
});

/**
 * Persist the chosen UI locale and re-render the current screen.
 *
 * Next.js returns the updated UI in the same round trip as the `Set-Cookie`,
 * so nothing here needs to revalidate: the reads that depend on the locale are
 * request-time reads inside `<Suspense>`, not cache entries. `<html lang>` is
 * the one thing the re-render leaves alone — it is rendered statically — so the
 * switcher sets that attribute in its own click handler.
 *
 * An unknown value is dropped rather than reported. The switcher offers exactly
 * the supported locales, so the only way to submit anything else is a forged
 * request, and there is no form state to show a message in.
 */
export const setAdminLocaleAction = async (
  formData: FormData
): Promise<void> => {
  const parsed = localeFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: { kind: "value", name: LOCALE_FIELD_NAME },
    })
  );
  if (!parsed.success) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(
    LOCALE_COOKIE_NAME,
    parsed.data.locale,
    adminLocaleCookieOptions
  );
};
