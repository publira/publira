import type { Locale } from "@publira/i18n";

import type { SignInIntent } from "./social-sign-in";
import { tenantLocalePath } from "./tenant-locale-path";

export interface SignInOrigin {
  intent: SignInIntent;
  locale: Locale;
  returnTo: string;
  tenantId: string;
}

/** The settings screen each confirming sign-in is started from. */
export const CONFIRMING_SCREENS: Record<
  Exclude<SignInIntent, "login">,
  string
> = {
  delete: "/settings",
  email_change: "/settings/security",
};

/**
 * Where a sign-in that did not finish sends the reader back to: the sign-in
 * screen, or the settings screen a deletion or an email change was confirmed
 * from. Without a message the reader chose to stop, and nothing is said about
 * it.
 */
export const signInFailurePath = async (
  { intent, locale, returnTo, tenantId }: SignInOrigin,
  message?: string
): Promise<string> => {
  if (intent !== "login") {
    const path = await tenantLocalePath(
      tenantId,
      locale,
      CONFIRMING_SCREENS[intent]
    );
    return message
      ? `${path}?${new URLSearchParams({ message, status: "error" }).toString()}`
      : path;
  }

  const path = await tenantLocalePath(tenantId, locale, "/login");
  const params = new URLSearchParams({ returnTo });
  if (message) {
    params.set("error", message);
  }
  return `${path}?${params.toString()}`;
};
