import {
  getLocales,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { cookies } from "next/headers";
import { z } from "zod";

import { LOCALE_FIELD_NAME } from "./locale-field";

/**
 * Options the locale cookie is written with.
 *
 * `httpOnly` is off: the inline `<head>` script reads this cookie to set
 * `<html lang>` before the first paint, which it can only do from
 * `document.cookie`. The value is a UI preference chosen from a fixed list.
 * The server parses it again on every request, so a hand-edited value is not
 * treated as a choice.
 */
export interface LocaleCookieOptions {
  httpOnly: false;
  maxAge: number;
  path: "/";
  sameSite: "lax";
  secure: boolean;
}

export const localeCookieOptions: LocaleCookieOptions = {
  httpOnly: false,
  maxAge: LOCALE_COOKIE_MAX_AGE,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

const localeFormSchema = z.object({
  locale: z.enum(getLocales()),
});

/**
 * Persist the chosen UI locale.
 *
 * The caller has already checked the request's origin. An unknown value is
 * dropped rather than reported: the switcher offers exactly the supported
 * locales, so anything else is a forged request, and there is no form state
 * to show a message in. Not a Server Action on its own — the app's action
 * file keeps `"use server"`.
 */
export const persistLocaleChoice = async (
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

  cookieStore.set(LOCALE_COOKIE_NAME, parsed.data.locale, localeCookieOptions);
};
