import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { getTenantDomainCandidates } from "@publira/utils/request-host";
import { suspendedTenantLocale } from "@publira/utils/suspended-tenant";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAdminCurrentUser, isTenantEditorRole } from "#lib/admin-auth";
import { buildLoginPath } from "#lib/admin-auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";
import { getAdminLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import type { SeriesImportResponse } from "#lib/series-import-manifest";
import { resolveTenantRouting, SUSPENDED_TENANT } from "#lib/tenant";
import {
  reserveUploadBytes,
  UPLOAD_RETRY_AFTER_SECONDS,
} from "#lib/upload-allowance";

export const respond = (
  body: EpisodePagesUploadResponse | SeriesImportResponse,
  status: number,
  headers: Record<string, string> = {}
) =>
  NextResponse.json(body, {
    headers: { ...headers, "Cache-Control": "private, no-store" },
    status,
  });

export const refuse = (message: string, status: number) =>
  respond({ message, ok: false }, status);

/**
 * The login page for a rejected session, coming back to the screen the upload
 * was sent from. The proxy records that path for a page, but these routes are
 * outside the proxy, so it is read from the `Referer` the same-origin check has
 * already held to this host.
 */
export const signInAgain = (request: NextRequest, t: AdminMessageAccessor) => {
  let returnTo: string | null = null;
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const url = new URL(referer);
      returnTo = `${url.pathname}${url.search}`;
    } catch {
      returnTo = null;
    }
  }

  return respond(
    {
      location: buildLoginPath(returnTo, { revoked: true }),
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    },
    401
  );
};

/** A page upload the route may go on to act on, with what it is answered in. */
export interface PageUploadForm {
  formData: FormData;
  locale: Locale;
  t: AdminMessageAccessor;
  tenantId: string;
}

/**
 * Reads the form of a page upload and hands it to `handle`, once everything
 * that does not need its body holds: the tenant is the one the host names, the
 * operator may edit it, the declared length is within `maxBytes`, and the
 * uploads the process is already holding leave room for that length
 * (`lib/upload-allowance.ts`). Reading the body only after that is what these
 * routes exist for (`lib/episode-pages-upload.ts`); anything else is answered
 * with the response to send instead.
 *
 * The length stays counted until `handle` has answered, since the form and
 * what the route builds from it are held until then.
 */
export const handlePageUpload = async (
  request: NextRequest,
  {
    maxBytes,
    tooLarge,
  }: {
    maxBytes: number;
    /** What a body declared over `maxBytes` is refused with. */
    tooLarge: (t: AdminMessageAccessor) => string;
  },
  handle: (form: PageUploadForm) => Promise<NextResponse>
): Promise<NextResponse> => {
  await assertSameOrigin();

  let tenantId: string | null;

  try {
    const routing = await resolveTenantRouting(
      getTenantDomainCandidates(request.headers)
    );

    // The screen the upload was sent from was open when the tenant was
    // suspended. Its next navigation lands on the page the proxy answers for
    // a suspended console, and until then the message says the same.
    if (routing === SUSPENDED_TENANT) {
      return refuse(
        sharedMessage(
          "admin.errors.suspended_description",
          suspendedTenantLocale(request)
        ),
        503
      );
    }

    ({ tenantId } = routing);
  } catch {
    return new NextResponse("Service Unavailable", {
      headers: { "Retry-After": "30" },
      status: 503,
    });
  }

  if (!tenantId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const [locale, operator] = await Promise.all([
    getAdminLocale(tenantId),
    getAdminCurrentUser(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  if (!operator.ok) {
    return operator.requiresSignIn
      ? signInAgain(request, t)
      : refuse(t("errors.rpc.forbidden"), 403);
  }

  if (!isTenantEditorRole(operator.user.role)) {
    return refuse(t("errors.rpc.forbidden"), 403);
  }

  // A browser always declares the length of a form it sends, and Node holds
  // the body to it, so the length is the size of what would be read.
  const contentLength = Number(request.headers.get("content-length") ?? "");

  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return refuse(t("admin.series.episodes.upload_failed"), 411);
  }

  if (contentLength > maxBytes) {
    return refuse(tooLarge(t), 413);
  }

  const release = reserveUploadBytes(tenantId, contentLength);

  if (!release) {
    return respond(
      { message: t("admin.series.uploads_busy"), ok: false },
      429,
      {
        "Retry-After": String(UPLOAD_RETRY_AFTER_SECONDS),
      }
    );
  }

  try {
    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return refuse(t("admin.series.episodes.upload_failed"), 400);
    }

    return await handle({ formData, locale, t, tenantId });
  } finally {
    release();
  }
};
