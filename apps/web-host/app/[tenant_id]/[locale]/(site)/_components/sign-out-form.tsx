"use client";

import type { Locale } from "@publira/i18n";
import { SiteLayoutUserMenuLogout } from "@publira/layouts";
import type { ReactNode } from "react";

import {
  isBrowserPushSupported,
  readPushSubscription,
} from "#lib/browser-push";
import { unregisterBrowserPushAction } from "#lib/push-actions";

/**
 * Take this browser off the delivery list before the session it was registered
 * under is gone. Without it the next reader to sign in on this browser would be
 * shown the episodes the previous one followed.
 *
 * Every failure is swallowed, which is the same allowance signing out already
 * has for revoking the session upstream: the cookie is cleared either way, and
 * a reader who cannot sign out because a push service is unreachable is worse
 * off than one whose subscription outlives the session. An endpoint left behind
 * is not permanent — the server drops it the first time the push service
 * answers `410 Gone`.
 */
const dropBrowserPushSubscription = async (
  locale: Locale,
  tenantId: string
): Promise<void> => {
  if (!isBrowserPushSupported()) {
    return;
  }

  try {
    const subscription = await readPushSubscription();
    if (!subscription) {
      return;
    }

    await unregisterBrowserPushAction({
      endpoint: subscription.endpoint,
      locale,
      tenantId,
    });
    await subscription.unsubscribe();
  } catch {
    // Signing out proceeds regardless; see above.
  }
};

/**
 * The account menu's sign-out form, wrapped so the browser's push subscription
 * is dropped on the way out. The Server Action itself stays in `lib/` — this
 * component only adds the part that has to happen in the browser.
 */
export const SignOutForm = ({
  children,
  locale,
  signOut,
  tenantId,
}: {
  children: ReactNode;
  locale: Locale;
  signOut: (formData: FormData) => Promise<void>;
  tenantId: string;
}) => (
  <SiteLayoutUserMenuLogout
    action={async (formData) => {
      await dropBrowserPushSubscription(locale, tenantId);
      await signOut(formData);
    }}
  >
    {children}
  </SiteLayoutUserMenuLogout>
);
