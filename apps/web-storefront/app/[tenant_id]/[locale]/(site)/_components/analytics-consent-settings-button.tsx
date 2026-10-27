"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  reopenAnalyticsConsentBanner,
  useAnalyticsConsent,
} from "#lib/analytics-consent";
import { loadsGoogleTagOn } from "#lib/google-tag-scripts";
import { toBarePathname } from "#lib/locale-path";

/**
 * **Cookie settings** in the footer, which brings the banner back so the
 * reader can change their answer. It is a button among the footer's links,
 * drawn like them.
 *
 * A browser sending Global Privacy Control has nothing to change, and a page
 * that loads no tag shows no banner, so neither shows the button.
 */
export const AnalyticsConsentSettingsButton = ({
  children,
  cookieName,
}: {
  children: ReactNode;
  cookieName: string;
}) => {
  const pathname = usePathname();
  const consent = useAnalyticsConsent(cookieName);
  if (
    consent === "global_privacy_control" ||
    !loadsGoogleTagOn(toBarePathname(pathname))
  ) {
    return null;
  }

  return (
    <button
      className="transition-colors duration-state ease-state hover:text-foreground"
      onClick={reopenAnalyticsConsentBanner}
      type="button"
    >
      {children}
    </button>
  );
};
