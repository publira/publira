import { isMissingResourceRpcError } from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import { cachedReadFailure } from "@publira/utils/cached-read";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { isPlaceholderStaticParam } from "@publira/utils/static-param-placeholder";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantMobileAppAssociationTag } from "./cache-tags";
import { isTenantIdFormat } from "./tenant-id-format";

export interface AndroidAppAssociation {
  applicationId: string;
  sha256CertFingerprints: string[];
}

export interface IosAppAssociation {
  bundleIdentifier: string;
  teamId: string;
}

/** A platform is absent where the tenant has no app on it. */
export interface TenantMobileAppAssociation {
  android?: AndroidAppAssociation;
  ios?: IosAppAssociation;
}

/**
 * The apps the tenant's links open in. A tenant the API does not know has no
 * app on either platform; `ok: false` means the API could not be asked, which
 * the association documents must not publish as "no app".
 */
export const getTenantMobileAppAssociation = async (
  tenantId: string
): Promise<CachedReadResult<TenantMobileAppAssociation>> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  applyCacheTag(tenantMobileAppAssociationTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenantMobileAppAssociation({
      tenant: { tenantId: normalizedTenantId },
    });
    return {
      ok: true,
      value: {
        android: response.android && {
          applicationId: response.android.applicationId,
          sha256CertFingerprints: response.android.sha256CertFingerprints,
        },
        ios: response.ios && {
          bundleIdentifier: response.ios.bundleIdentifier,
          teamId: response.ios.teamId,
        },
      },
    };
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { ok: true, value: {} };
    }
    console.warn("[web-host] getTenantMobileAppAssociation failed", error);
    return cachedReadFailure("The mobile app association is unavailable.");
  }
};

/** The Digital Asset Links statement that lets the app verify its App Links. */
export const toAssetLinks = (android: AndroidAppAssociation) => [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: android.applicationId,
      sha256_cert_fingerprints: android.sha256CertFingerprints,
    },
  },
];

/**
 * The paths the app opens, the same ones its Android manifest claims as App
 * Links. `*` in an AASA component matches across segments, as `pathPrefix`
 * does there.
 */
const APP_LINK_PATHS = [
  "/series/*",
  "/checkout/return",
  "/verify",
  "/reset-password",
  "/confirm-password",
  "/confirm-email",
  "/announcements",
] as const;

/**
 * Every claimed path, bare and under each locale prefix, since the tenant's
 * default locale is the unprefixed one and any locale can be that default.
 */
const appLinkComponents = () =>
  ["", ...getLocales().map((locale) => `/${locale}`)].flatMap((prefix) =>
    APP_LINK_PATHS.map((path) => ({ "/": `${prefix}${path}` }))
  );

/** The apple-app-site-association document that lets the app open Universal Links. */
export const toAppleAppSiteAssociation = (ios: IosAppAssociation) => ({
  applinks: {
    details: [
      {
        appIDs: [`${ios.teamId}.${ios.bundleIdentifier}`],
        components: appLinkComponents(),
      },
    ],
  },
});

/** Short, like `/theme.css`; a save in the console revalidates the read behind it. */
const CACHE_CONTROL =
  "public, max-age=30, s-maxage=30, stale-while-revalidate=60";

/**
 * Answer an association document for the tenant `proxy.ts` rewrote the
 * request onto. `toDocument` returns `undefined` where the tenant has no app on
 * the platform, which is a 404 rather than a document naming some other app.
 * An API that could not be asked is a 503, so a verifier retries instead of
 * recording that the site claims no app.
 */
export const respondWithMobileAppAssociation = async (
  tenantId: string,
  toDocument: (association: TenantMobileAppAssociation) => unknown
): Promise<Response> => {
  // The placeholder appears while generating static paths, and a non-UUID
  // segment means the request bypassed `proxy.ts`: either way there is no
  // tenant to ask about.
  if (isPlaceholderStaticParam(tenantId) || !isTenantIdFormat(tenantId)) {
    return new Response("Not Found", { status: 404 });
  }

  const association = await getTenantMobileAppAssociation(tenantId);
  if (!association.ok) {
    return new Response("Service Unavailable", {
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      status: 503,
    });
  }

  const document = toDocument(association.value);
  if (document === undefined) {
    return new Response("Not Found", {
      headers: { "Cache-Control": CACHE_CONTROL },
      status: 404,
    });
  }

  return Response.json(document, {
    headers: { "Cache-Control": CACHE_CONTROL },
  });
};
