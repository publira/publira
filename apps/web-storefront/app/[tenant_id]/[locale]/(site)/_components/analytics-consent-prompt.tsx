"use client";

import { Button } from "@publira/ui-components/button";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { useClientMessages } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";
import {
  answerAnalyticsConsent,
  onAnalyticsConsentBannerReopen,
  useAnalyticsConsent,
} from "#lib/analytics-consent";
import type { AnalyticsConsentAnswer } from "#lib/analytics-consent";
import { loadsGoogleTagOn } from "#lib/google-tag-scripts";
import { toBarePathname } from "#lib/locale-path";

/**
 * The question itself, at the foot of the window on a reader's first visit,
 * and again whenever **Cookie settings** asks for it.
 *
 * It is not a dialog: the page around it keeps working, and only **Accept**
 * and **Decline** answer it. The two carry the same weight, so neither is the
 * answer the site would rather have. It is sticky at the end of the chrome,
 * so it follows the reader down the page and never covers the footer that
 * the page ends on.
 *
 * Nothing of it is in the HTML: the answer is read once the page has hydrated,
 * and a browser sending Global Privacy Control has already declined. The pages
 * that load no tag show none either, since there is nothing on them to agree
 * to.
 */
export const AnalyticsConsentPrompt = ({
  cookieName,
  privacyPage,
}: {
  cookieName: string;
  /** The page the tenant names as its privacy policy, where there is one. */
  privacyPage?: { href: string; title: string };
}) => {
  const t = useClientMessages();
  const titleId = useId();
  const pathname = usePathname();
  const consent = useAnalyticsConsent(cookieName);
  const [reopened, setReopened] = useState(false);

  useEffect(
    () =>
      onAnalyticsConsentBannerReopen(() => {
        setReopened(true);
      }),
    []
  );

  const answered = consent === "granted" || consent === "denied";
  if (
    !(consent === "unanswered" || (reopened && answered)) ||
    !loadsGoogleTagOn(toBarePathname(pathname))
  ) {
    return null;
  }

  const answer = (value: AnalyticsConsentAnswer) => {
    answerAnalyticsConsent(cookieName, value);
    setReopened(false);
  };

  return (
    <section
      aria-labelledby={titleId}
      className="sticky bottom-0 z-20 border-t border-border bg-surface"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="grid min-w-0 gap-1 text-sm">
          <h2 className="font-medium" id={titleId}>
            {t("storefront.analytics_consent.title")}
          </h2>
          <p className="text-muted-foreground">
            {t("storefront.analytics_consent.description")}
          </p>
          <p className="text-muted-foreground">
            {t("storefront.analytics_consent.change")}
          </p>
          {privacyPage ? (
            <p>
              <LocaleLink
                className="font-medium text-primary underline underline-offset-4"
                href={privacyPage.href}
              >
                {privacyPage.title}
              </LocaleLink>
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button
            onClick={() => {
              answer("granted");
            }}
            variant="outline"
          >
            {t("storefront.analytics_consent.accept")}
          </Button>
          <Button
            onClick={() => {
              answer("denied");
            }}
            variant="outline"
          >
            {t("storefront.analytics_consent.decline")}
          </Button>
        </div>
      </div>
    </section>
  );
};
