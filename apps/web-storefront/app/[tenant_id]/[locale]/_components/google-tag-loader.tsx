"use client";

import { GoogleTagManager } from "@next/third-parties/google";
import { usePathname } from "next/navigation";
import Script from "next/script";

import { useAnalyticsConsent } from "#lib/analytics-consent";
import {
  gtagConsentDefaultScript,
  gtagInitScript,
  loadsGoogleTagOn,
} from "#lib/google-tag-scripts";
import type {
  GoogleTagScripts,
  GoogleTagSettings,
} from "#lib/google-tag-scripts";
import { toBarePathname } from "#lib/locale-path";

const GoogleTagScriptsLoader = ({ ga4, gtm }: GoogleTagScripts) => (
  <>
    {gtm ? (
      <GoogleTagManager gtmId={gtm.containerId} gtmScriptUrl={gtm.scriptUrl} />
    ) : null}
    {ga4 ? (
      <>
        <Script
          dangerouslySetInnerHTML={{ __html: gtagInitScript(ga4) }}
          id="publira-gtag-init"
        />
        <Script id="publira-gtag" src={ga4.src} />
      </>
    ) : null}
  </>
);

/**
 * Loads the tenant's Google tag, except on the pages `loadsGoogleTagOn`
 * leaves out.
 *
 * The root layout keeps this mounted across client navigations, and
 * `next/script` runs a script of a given `id` once per document, so the load's
 * `config` and `gtm.js` event are never repeated. The page view of each
 * navigation is the Google tag's own, sent from the history change — GA4's
 * enhanced measurement, or the container's history trigger — so nothing here
 * sends another.
 *
 * The path is checked as the page renders, so a page opened directly from an
 * excluded path loads nothing. A tag already loaded keeps running after a
 * client navigation into one: unmounting a script does not unload it.
 *
 * GTM goes through `@next/third-parties`, which takes the server container's
 * and the gateway's loader URL. Its GA4 component loads from Google alone and
 * passes no `config` parameters, so gtag.js is written here in every mode.
 *
 * Where the tenant asks for consent, the Consent Mode defaults come first:
 * `next/script` runs each script from an Effect, and sibling Effects run in
 * order, so they reach the `dataLayer` before either tag does. Under `opt_in`
 * the tags are not rendered until the reader has agreed, which also keeps the
 * `<link rel="preload">` `next/script` renders for a loader out of the HTML:
 * nothing of Google is requested before the answer. The answer is read only
 * once the page has hydrated, so the HTML is the same for every reader.
 */
export const GoogleTagLoader = ({
  consent,
  ...scripts
}: GoogleTagScripts & {
  /**
   * Absent where the tenant asks no reader, which leaves the page exactly as
   * it was before the setting existed. `cookieName` is where the banner
   * keeps the reader's answer.
   */
  consent?: {
    cookieName: string;
    mode: Exclude<GoogleTagSettings["consentMode"], "not_required">;
  };
}) => {
  const pathname = usePathname();
  const answer = useAnalyticsConsent(consent?.cookieName ?? "");

  if (!loadsGoogleTagOn(toBarePathname(pathname))) {
    return null;
  }

  if (!consent) {
    return <GoogleTagScriptsLoader {...scripts} />;
  }

  return (
    <>
      <Script
        dangerouslySetInnerHTML={{
          __html: gtagConsentDefaultScript(
            consent.mode === "opt_in" ? consent.cookieName : null
          ),
        }}
        id="publira-gtag-consent"
      />
      {consent.mode === "external" || answer === "granted" ? (
        <GoogleTagScriptsLoader {...scripts} />
      ) : null}
    </>
  );
};
