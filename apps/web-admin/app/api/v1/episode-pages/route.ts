import type { Locale } from "@publira/i18n";
import { getTenantDomainCandidates } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminCurrentUser, isTenantEditorRole } from "#lib/admin-auth";
import { buildLoginPath, isUnauthenticatedError } from "#lib/admin-auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import {
  episodeCacheTag,
  episodesCacheTag,
  uploadEpisodePages,
} from "#lib/episode";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";
import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";
import {
  fileListFormSchema,
  optionalFileFormSchema,
  optionalRecordId,
  requiredRecordId,
} from "#lib/form-schemas";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { resolveTenantRouting } from "#lib/tenant";

const respond = (body: EpisodePagesUploadResponse, status: number) =>
  NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });

const refuse = (message: string, status: number) =>
  respond({ message, ok: false }, status);

/**
 * The login page for a rejected session, coming back to the screen the upload
 * was sent from. The proxy records that path for a page, but this route is
 * outside the proxy, so it is read from the `Referer` the same-origin check has
 * already held to this host.
 */
const signInAgain = (request: NextRequest, t: AdminMessageAccessor) => {
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

const uploadFormSchema = (t: AdminMessageAccessor) =>
  z.object({
    archive: optionalFileFormSchema,
    episodeId: requiredRecordId(
      t("admin.series.episodes.validation.episode_missing")
    ),
    pages: fileListFormSchema,
    // An archive is unpacked against its series, which the API cannot infer.
    seriesId: optionalRecordId(),
    uploadMode: z.preprocess(
      (value) => (value === "zip" || value === "epub" ? value : "pages"),
      z.enum(["pages", "zip", "epub"])
    ),
  });

const isArchiveOfMode = (archive: File, mode: "epub" | "zip") => {
  const name = archive.name.toLowerCase();
  const type = archive.type.toLowerCase();

  return mode === "zip"
    ? type === "application/zip" || name.endsWith(".zip")
    : type.includes("application/epub+zip") || name.endsWith(".epub");
};

type UploadInput = Parameters<typeof uploadEpisodePages>[0];

/** What the form asks to upload, or why it cannot be. */
const readUpload = (
  formData: FormData,
  tenantId: string,
  t: AdminMessageAccessor,
  locale: Locale
): { input: UploadInput } | { refusal: string } => {
  const parsed = uploadFormSchema(t).safeParse(
    toFormDataInput(formData, {
      archive: { kind: "file", name: "archive" },
      episodeId: { kind: "value", name: "episode_id" },
      pages: { kind: "files", name: "pages" },
      seriesId: { kind: "value", name: "series_id" },
      uploadMode: { kind: "value", name: "upload_mode" },
    })
  );
  if (!parsed.success) {
    return { refusal: toFormErrorMessage(parsed.error, { locale }) };
  }
  const { archive, episodeId, pages, seriesId, uploadMode } = parsed.data;

  if (uploadMode === "pages") {
    return pages.length === 0
      ? { refusal: t("admin.series.episodes.validation.pages_required") }
      : { input: { episodeId, pages, tenantId } };
  }
  if (seriesId === "") {
    return { refusal: t("admin.series.episodes.validation.series_missing") };
  }
  if (!archive) {
    return {
      refusal:
        uploadMode === "zip"
          ? t("admin.series.episodes.validation.zip_required")
          : t("admin.series.episodes.validation.epub_required"),
    };
  }
  if (!isArchiveOfMode(archive, uploadMode)) {
    return {
      refusal:
        uploadMode === "zip"
          ? t("admin.series.episodes.validation.zip_invalid")
          : t("admin.series.episodes.validation.epub_invalid"),
    };
  }
  return { input: { archive, episodeId, seriesId, tenantId } };
};

/**
 * Adds the page images, ZIP, or ePub the episode edit screen submits.
 *
 * The tenant is the one the host names, the operator must be able to edit it,
 * and the declared length must be within {@link EPISODE_PAGES_UPLOAD_MAX_BYTES}
 * — all before the body is read, which is what this route is for. The
 * answer is JSON for the screen's `fetch`; a success expires the episode's
 * tags, and the screen refreshes itself.
 */
export const POST = async (request: NextRequest) => {
  await assertSameOrigin();

  let tenantId: string | null;
  try {
    ({ tenantId } = await resolveTenantRouting(
      getTenantDomainCandidates(request.headers)
    ));
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
    getLocale(tenantId),
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
  if (contentLength > EPISODE_PAGES_UPLOAD_MAX_BYTES) {
    return refuse(t("admin.series.episodes.validation.upload_too_large"), 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return refuse(t("admin.series.episodes.upload_failed"), 400);
  }

  const upload = readUpload(formData, tenantId, t, locale);
  if ("refusal" in upload) {
    return refuse(upload.refusal, 400);
  }
  const { input } = upload;

  let result: Awaited<ReturnType<typeof uploadEpisodePages>>;
  try {
    result = await uploadEpisodePages(input, locale);
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return signInAgain(request, t);
    }
    throw error;
  }
  if (!result.ok) {
    return refuse(result.message, 422);
  }

  // The screen refreshes once this answers, so nothing it reads may be served
  // stale; `updateTag` would say the same, but it is for Server Actions only.
  revalidateTag(episodesCacheTag(tenantId), { expire: 0 });
  revalidateTag(episodeCacheTag(tenantId, input.episodeId), { expire: 0 });

  return respond(
    { message: t("admin.series.episodes.pages_uploaded"), ok: true },
    200
  );
};
