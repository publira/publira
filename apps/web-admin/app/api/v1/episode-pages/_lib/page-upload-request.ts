import type { Locale } from "@publira/i18n";
import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAdminCurrentUser, isTenantEditorRole } from "#lib/admin-auth";
import { buildLoginPath } from "#lib/admin-auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { resolveTenantRouting } from "#lib/tenant";

export const respond = (body: EpisodePagesUploadResponse, status: number) =>
  NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
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
 * Reads the form of a page upload, once everything that does not need its body
 * holds: the tenant is the one the host names, the operator may edit it, and
 * the declared length is within `maxBytes`. Reading the body only after that
 * is what these routes exist for (`lib/episode-pages-upload.ts`); anything
 * else is answered with the response to send instead.
 */
export const readPageUploadForm = async (
  request: NextRequest,
  {
    maxBytes,
    tooLarge,
  }: {
    maxBytes: number;
    /** What a body declared over `maxBytes` is refused with. */
    tooLarge: (t: AdminMessageAccessor) => string;
  }
): Promise<PageUploadForm | { response: NextResponse }> => {
  await assertSameOrigin();

  let tenantId: string | null;
  try {
    ({ tenantId } = await resolveTenantRouting(
      getTenantDomainCandidates(request.headers)
    ));
  } catch {
    return {
      response: new NextResponse("Service Unavailable", {
        headers: { "Retry-After": "30" },
        status: 503,
      }),
    };
  }
  if (!tenantId) {
    return { response: new NextResponse("Not Found", { status: 404 }) };
  }

  const [locale, operator] = await Promise.all([
    getLocale(tenantId),
    getAdminCurrentUser(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  if (!operator.ok) {
    return {
      response: operator.requiresSignIn
        ? signInAgain(request, t)
        : refuse(t("errors.rpc.forbidden"), 403),
    };
  }
  if (!isTenantEditorRole(operator.user.role)) {
    return { response: refuse(t("errors.rpc.forbidden"), 403) };
  }

  // A browser always declares the length of a form it sends, and Node holds
  // the body to it, so the length is the size of what would be read.
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return { response: refuse(t("admin.series.episodes.upload_failed"), 411) };
  }
  if (contentLength > maxBytes) {
    return { response: refuse(tooLarge(t), 413) };
  }

  try {
    return { formData: await request.formData(), locale, t, tenantId };
  } catch {
    return { response: refuse(t("admin.series.episodes.upload_failed"), 400) };
  }
};
