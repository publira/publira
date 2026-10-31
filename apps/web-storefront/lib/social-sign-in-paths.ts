import type { Locale } from "@publira/i18n";

import { SESSION_REVOKED_PARAM_NAME } from "./auth-shared";
import type { SignInIntent } from "./social-sign-in";
import { tenantLocalePath } from "./tenant-locale-path";

export interface SignInOrigin {
  intent: SignInIntent;
  locale: Locale;
  returnTo: string;
  tenantId: string;
}

/** The settings screen each sign-in for a signed-in reader is started from. */
export const CONFIRMING_SCREENS: Record<
  Exclude<SignInIntent, "login">,
  string
> = {
  delete: "/settings",
  email_change: "/settings/security",
  link: "/settings/security",
};

/**
 * Where a sign-in that did not finish sends the reader back to: the sign-in
 * screen, or the settings screen a deletion, an email change, or a link was
 * started from. Without a message the reader chose to stop, and nothing is
 * said about it.
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

/**
 * The `reason` a first sign-in refused because the tenant has closed sign-up
 * carries to the sign-in screen, which shows the tenant's notice for it.
 */
export const SIGN_UP_CLOSED_REASON = "sign_up_closed";

/**
 * Where a first sign-in the tenant's closed sign-up refused sends the reader:
 * the sign-in screen, which keeps the way in for a reader who has an account
 * and says why none could be made.
 */
export const signUpClosedPath = async ({
  locale,
  returnTo,
  tenantId,
}: Omit<SignInOrigin, "intent">): Promise<string> => {
  const path = await tenantLocalePath(tenantId, locale, "/login");

  const params = new URLSearchParams({
    [SESSION_REVOKED_PARAM_NAME]: SIGN_UP_CLOSED_REASON,
    returnTo,
  });

  return `${path}?${params.toString()}`;
};
