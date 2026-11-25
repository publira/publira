import { SERIES_IMPORT_MAX_BYTES } from "#lib/series-import-manifest";

/**
 * The most the bodies of one tenant's uploads may declare between them while
 * this process is handling them: room for its largest upload, a series import,
 * and so for two batches of pages, or a batch and the replacements beside it.
 */
export const TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES = SERIES_IMPORT_MAX_BYTES;

/**
 * The most the bodies of every tenant's uploads may declare between them while
 * this process is handling them.
 *
 * The console holds an upload whole, several times over: Node parsing the form
 * of a 256MiB ZIP took the process from 60MiB to about 800MiB of RSS, and the
 * copy the import makes of the archive to about 1GiB, before a page was
 * unpacked. So what the console needs is a multiple of this sum rather than of
 * one upload, and twice a tenant's share keeps one tenant from taking all of
 * it.
 *
 * The count is per process: every copy of the console holds what it was sent
 * and nothing else, so it is a copy's own memory that it bounds.
 */
export const UPLOADS_IN_FLIGHT_MAX_BYTES =
  2 * TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES;

/**
 * How long a refused upload is told to wait, in seconds: about as long as one
 * upload ahead of it takes to send and store.
 */
export const UPLOAD_RETRY_AFTER_SECONDS = 30;

interface UploadsInFlight {
  byTenant: Map<string, number>;
  total: number;
}

const uploadsInFlightKey = Symbol.for("publira.web-admin.uploads-in-flight");

/**
 * The declared bytes of the uploads this process is handling. Every upload
 * route is compiled into a bundle of its own, so the count lives on
 * `globalThis` for all of them to share.
 */
const uploadsInFlight = (): UploadsInFlight => {
  // SAFETY: the property is this module's own count, created below when absent.
  const host = globalThis as typeof globalThis &
    Record<symbol, UploadsInFlight | undefined>;

  const existing = host[uploadsInFlightKey];

  if (existing) {
    return existing;
  }

  const created: UploadsInFlight = { byTenant: new Map(), total: 0 };

  host[uploadsInFlightKey] = created;

  return created;
};

/**
 * Counts an upload of `bytes` for `tenantId` as in flight, and returns what
 * stops counting it — or `null`, counting nothing, when either the tenant's
 * share or the process's sum would go over its limit. The function returned
 * does its work once, however many times it is called.
 */
export const reserveUploadBytes = (
  tenantId: string,
  bytes: number
): (() => void) | null => {
  const inFlight = uploadsInFlight();
  const tenantBytes = inFlight.byTenant.get(tenantId) ?? 0;

  if (
    tenantBytes + bytes > TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES ||
    inFlight.total + bytes > UPLOADS_IN_FLIGHT_MAX_BYTES
  ) {
    return null;
  }

  inFlight.byTenant.set(tenantId, tenantBytes + bytes);
  inFlight.total += bytes;

  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    inFlight.total -= bytes;

    const remaining = (inFlight.byTenant.get(tenantId) ?? 0) - bytes;

    if (remaining > 0) {
      inFlight.byTenant.set(tenantId, remaining);
    } else {
      inFlight.byTenant.delete(tenantId);
    }
  };
};
