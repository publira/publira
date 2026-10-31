import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { GoogleTagServingMode } from "@publira/api-client/public/types";
import type { TenantGoogleTag } from "@publira/api-client/public/types";
import { readTagRevalidatedAt } from "@publira/next-cache-handlers/tags";
import { LRUCache } from "lru-cache";

import { tenantAnalyticsSettingsTag } from "./cache-tags";

/**
 * A gateway path as `publira server` generates it (`NewGatewayPath` in
 * `server/internal/googletag`): an underscore and 16 characters of lowercase
 * base32. Only a first segment of this shape is looked up, so no other path of
 * the site waits on the tenant's Google tag settings, and none of the
 * `/_next/…` paths the proxy sees can be taken for one.
 */
const GATEWAY_PATH_SEGMENT = /^\/(?<path>_[a-z2-7]{16})(?:\/|$)/u;

/** The first segment of `pathname` when it has the shape of a gateway path. */
export const gatewayPathSegmentOf = (pathname: string): string | null =>
  GATEWAY_PATH_SEGMENT.exec(pathname)?.groups?.path ?? null;

/** Where the gateway forwards to. */
export type GoogleTagGatewayUpstream =
  /** Google's gateway for the tag, `https://<tagId>.fps.goog`. */
  | { mode: "google"; tagId: string }
  /** The tenant's server container, an `https` origin the tenant typed. */
  | { mode: "server_container"; origin: string };

/** The gateway a tenant in `GATEWAY` mode has Publira run on its site. */
export interface GoogleTagGateway {
  /** The first path segment it answers on, without slashes. */
  path: string;
  upstream: GoogleTagGatewayUpstream;
}

type RawTenantGoogleTag = Pick<
  TenantGoogleTag,
  | "ga4MeasurementId"
  | "gatewayPath"
  | "gtmContainerId"
  | "serverContainerUrl"
  | "servingMode"
>;

/**
 * The gateway the settings describe, or `null` for a tenant that is not in
 * `GATEWAY` mode or names no tag.
 *
 * Google's gateway is addressed by one tag, and the Tag Manager container is
 * the one that covers every tag it fires, so it is preferred to the GA4
 * measurement ID. A tenant with both loads both scripts from the one path;
 * the container's gateway serves the GA4 loader as well.
 */
export const toGoogleTagGateway = (
  tag: RawTenantGoogleTag | undefined
): GoogleTagGateway | null => {
  if (tag?.servingMode !== GoogleTagServingMode.GATEWAY) {
    return null;
  }

  const path = tag.gatewayPath?.trim() ?? "";

  const tagId =
    tag.gtmContainerId?.trim() || tag.ga4MeasurementId?.trim() || "";

  if (gatewayPathSegmentOf(`/${path}`) !== path || !tagId) {
    return null;
  }

  const serverContainerUrl = tag.serverContainerUrl?.trim() ?? "";

  if (!serverContainerUrl) {
    return { path, upstream: { mode: "google", tagId } };
  }

  let origin: URL;

  try {
    origin = new URL(serverContainerUrl);
  } catch {
    return null;
  }

  return origin.protocol === "https:"
    ? { path, upstream: { mode: "server_container", origin: origin.origin } }
    : null;
};

interface GatewayEntry {
  gateway: GoogleTagGateway | null;
  /** When the read that produced `gateway` started (ms since the epoch). */
  readAt: number;
}

/**
 * A tenant's Google tag gateway, held per instance for the proxy, where no
 * `"use cache"` runs. The console's save revalidates
 * `tenantAnalyticsSettingsTag`, which is read back from the shared Redis on
 * every call, so a regenerated path stops answering on the next request; when
 * Redis cannot be read, `ttl` bounds how stale the answer gets.
 */
export const createGoogleTagGatewayResolver = (
  publicApiClient: PublicApiClient,
  options?: {
    max?: number;
    now?: () => number;
    readRevalidatedAt?: (tag: string) => Promise<number | undefined>;
    ttl?: number;
  }
) => {
  const now = options?.now ?? (() => Temporal.Now.instant().epochMilliseconds);
  const readRevalidatedAt = options?.readRevalidatedAt ?? readTagRevalidatedAt;

  const cache = new LRUCache<string, GatewayEntry>({
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 60_000,
  });

  const inFlight = new Map<string, Promise<GatewayEntry | null>>();

  const read = async (tenantId: string): Promise<GatewayEntry | null> => {
    const readAt = now();

    try {
      const response = await publicApiClient.tenant.getTenantAnalyticsSettings({
        tenant: { tenantId },
      });

      const entry = { gateway: toGoogleTagGateway(response.googleTag), readAt };
      cache.set(tenantId, entry);

      return entry;
    } catch (error) {
      // A failure the client cannot classify is reported rather than taken for
      // a tenant with no gateway, which would send its path to the 404.
      rethrowUnclassifiedRpcError(error);

      return null;
    }
  };

  const readOnce = (tenantId: string) => {
    const pending = inFlight.get(tenantId);

    if (pending) {
      return pending;
    }

    const started = (async () => {
      try {
        return await read(tenantId);
      } finally {
        inFlight.delete(tenantId);
      }
    })();

    inFlight.set(tenantId, started);

    return started;
  };

  /**
   * `null` for a tenant with no gateway, or whose settings the API cannot
   * serve right now. Rejects with an error the client cannot classify.
   */
  return async function resolveGoogleTagGateway(
    tenantId: string
  ): Promise<GoogleTagGateway | null> {
    const cached = cache.get(tenantId);

    const revalidatedAt = await readRevalidatedAt(
      tenantAnalyticsSettingsTag(tenantId)
    );

    // `undefined` is a Redis that cannot be read; the entry's TTL covers it.
    if (
      cached &&
      (revalidatedAt === undefined || cached.readAt > revalidatedAt)
    ) {
      return cached.gateway;
    }

    const entry = await readOnce(tenantId);

    // A failed read keeps the gateway that was held rather than dropping the
    // tag's requests to the 404 until the API answers again.
    return entry ? entry.gateway : (cached?.gateway ?? null);
  };
};
