import type { Locale } from "@publira/i18n";

import type { SignInIntent } from "./social-sign-in";
import { tenantLocalePath } from "./tenant-locale-path";

export interface SignInOrigin {
  intent: SignInIntent;
  locale: Locale;
  returnTo: string;
  tenantId: string;
}

/**
 * Where a sign-in that did not finish sends the reader back to: the sign-in
 * screen, or the settings screen a deletion was confirmed from. Without a
 * message the reader chose to stop, and nothing is said about it.
 */
export const signInFailurePath = async (
  { intent, locale, returnTo, tenantId }: SignInOrigin,
  message?: string
): Promise<string> => {
  if (intent === "delete") {
    const path = await tenantLocalePath(tenantId, locale, "/settings");
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
