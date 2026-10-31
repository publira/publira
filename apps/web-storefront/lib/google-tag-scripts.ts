import { ACCOUNT_FLOW_PATHS, GUEST_ONLY_PATHS } from "./reader-paths";

/** Where the tenant's Google tag is loaded from, with what each mode needs. */
export type GoogleTagServing =
  | { gatewayPath: string; mode: "gateway" }
  | { mode: "google" }
  | { mode: "server_container"; serverContainerUrl: string };

/** The Google tag a tenant's pages load. At least one of the IDs is set. */
export interface GoogleTagSettings {
  /**
   * Whether a reader is asked before the tag runs: `not_required` runs it at
   * once, `opt_in` holds it back until the reader agrees on the site's own
   * banner, and `external` starts it with every signal denied for the consent
   * tool inside the tenant's container to update.
   */
  consentMode: "external" | "not_required" | "opt_in";
  /** `G-…`, or empty where the tenant has no GA4 stream of its own. */
  ga4MeasurementId: string;
  /** `GTM-…`, or empty where the tenant has no Tag Manager container. */
  gtmContainerId: string;
  serving: GoogleTagServing;
}

/** The scripts a page loads for one tenant's Google tag. */
export interface GoogleTagScripts {
  /** gtag.js, and the `config` command the page starts it with. */
  ga4?: {
    config?: Record<string, string>;
    measurementId: string;
    src: string;
  };
  /**
   * gtm.js, in the shape `GoogleTagManager` from `@next/third-parties` takes
   * it: the loader URL without the `id` it appends, absent for Google's own.
   */
  gtm?: {
    containerId: string;
    scriptUrl?: string;
  };
}

const GOOGLE_TAG_ORIGIN = "https://www.googletagmanager.com";

const withId = (url: URL, id: string): string => {
  url.searchParams.set("id", id);

  return url.href;
};

/**
 * The loader URLs for each mode.
 *
 * In `server_container` both loaders come from the tenant's server container,
 * which serves them under Google's own paths, and GA4 is told to send its hits
 * there. In `gateway` both come from the path on the storefront's own origin,
 * which forwards them; the hits follow the script there without being told.
 * Both loaders name their tag with `?id=`, the form Google's gateway snippet
 * gives gtm.js, so one path serves a tenant that has both IDs.
 *
 * `origin` is the storefront's own, which only `gateway` reads: the
 * `@next/third-parties` loader takes an absolute URL. Without it the gateway
 * cannot be named, and the page loads no tag rather than one from an origin
 * the tenant did not choose.
 */
export const googleTagScripts = (
  settings: GoogleTagSettings,
  origin: string | null
): GoogleTagScripts | null => {
  const { ga4MeasurementId, gtmContainerId, serving } = settings;

  let base: URL;
  let ga4Path: string;
  let gtmScriptUrl: string | undefined;
  let ga4Config: Record<string, string> | undefined;

  switch (serving.mode) {
    case "google": {
      base = new URL(GOOGLE_TAG_ORIGIN);
      ga4Path = "/gtag/js";
      break;
    }

    case "server_container": {
      base = new URL(serving.serverContainerUrl);
      ga4Path = "/gtag/js";
      gtmScriptUrl = new URL("/gtm.js", base).href;
      ga4Config = { server_container_url: base.origin };
      break;
    }

    case "gateway": {
      if (!origin) {
        return null;
      }

      base = new URL(`/${serving.gatewayPath}/`, origin);
      ga4Path = base.pathname;
      gtmScriptUrl = base.href;
      break;
    }

    default: {
      return null;
    }
  }

  return {
    ...(ga4MeasurementId && {
      ga4: {
        ...(ga4Config && { config: ga4Config }),
        measurementId: ga4MeasurementId,
        src: withId(new URL(ga4Path, base), ga4MeasurementId),
      },
    }),
    ...(gtmContainerId && {
      gtm: {
        containerId: gtmContainerId,
        ...(gtmScriptUrl && { scriptUrl: gtmScriptUrl }),
      },
    }),
  };
};

/**
 * Pages that load no tag: every screen that takes a reader's password, a
 * passkey, or a token a mail carries — signing in and up, the account flows,
 * and the account settings. A payment is taken on the provider's own page,
 * and the series page a checkout returns to is measured as usual, so a
 * conversion is recorded on the page that follows.
 */
const UNTAGGED_PATHS = [
  ...GUEST_ONLY_PATHS,
  ...ACCOUNT_FLOW_PATHS,
  "/settings",
] as const;

/** Whether the page at a bare path (`toBarePathname`) loads the tag. */
export const loadsGoogleTagOn = (barePathname: string): boolean =>
  !UNTAGGED_PATHS.some(
    (path) => barePathname === path || barePathname.startsWith(`${path}/`)
  );

/** What a script below writes into a `gtag()` call: an id or a parameter map. */
type ScriptArgument = string | Readonly<Record<string, number | string>>;

const scriptLiteral = (value: ScriptArgument): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

/**
 * The inline half of Google's gtag.js snippet, whose `config` sends the page
 * view of the load.
 */
export const gtagInitScript = ({
  config,
  measurementId,
}: NonNullable<GoogleTagScripts["ga4"]>): string => {
  const configArguments = [measurementId, ...(config ? [config] : [])]
    .map(scriptLiteral)
    .join(",");

  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js',new Date());",
    `gtag('config',${configArguments});`,
  ].join("");
};

/** Every signal of Google Consent Mode v2 set to one answer. */
export const consentSignals = (answer: "denied" | "granted") => ({
  ad_personalization: answer,
  ad_storage: answer,
  ad_user_data: answer,
  analytics_storage: answer,
});

/**
 * How long the tag holds its first hit for an `update`, in milliseconds. The
 * stored answer follows the default in the same script, so this only covers a
 * consent tool inside the container that answers once it has loaded.
 */
const CONSENT_WAIT_FOR_UPDATE_MS = 500;

/**
 * The Consent Mode v2 defaults, which have to reach the `dataLayer` before
 * the tag does: every signal `denied`, for every reader, since the site has
 * no region it could trust to tell readers apart.
 *
 * `grantCookieName` is the cookie a reader's answer on the site's own banner
 * is kept in. A stored grant is sent as an `update` straight after the
 * default, so a returning reader's first hit is measured as granted. A browser
 * sending Global Privacy Control is never treated as having granted, whatever
 * the cookie says.
 */
export const gtagConsentDefaultScript = (
  grantCookieName: string | null
): string =>
  [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    `gtag('consent','default',${scriptLiteral({
      ...consentSignals("denied"),
      wait_for_update: CONSENT_WAIT_FOR_UPDATE_MS,
    })});`,
    ...(grantCookieName
      ? [
          `if(navigator.globalPrivacyControl!==true&&document.cookie.split('; ').includes(${scriptLiteral(
            `${grantCookieName}=granted`
          )}))`,
          `gtag('consent','update',${scriptLiteral(consentSignals("granted"))});`,
        ]
      : []),
  ].join("");
