"use client";

import { GoogleTagManager } from "@next/third-parties/google";
import { usePathname } from "next/navigation";
import Script from "next/script";

import { gtagInitScript, loadsGoogleTagOn } from "#lib/google-tag-scripts";
import type { GoogleTagScripts } from "#lib/google-tag-scripts";
import { toBarePathname } from "#lib/locale-path";

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
 */
export const GoogleTagLoader = ({ ga4, gtm }: GoogleTagScripts) => {
  const pathname = usePathname();
  if (!loadsGoogleTagOn(toBarePathname(pathname))) {
    return null;
  }

  return (
    <>
      {gtm ? (
        <GoogleTagManager
          gtmId={gtm.containerId}
          gtmScriptUrl={gtm.scriptUrl}
        />
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
};
