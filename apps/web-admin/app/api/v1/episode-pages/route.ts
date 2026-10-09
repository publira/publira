import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { isUnauthenticatedError } from "#lib/admin-auth-shared";
import {
  episodeCacheTag,
  episodesCacheTag,
  uploadEpisodePages,
} from "#lib/episode";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";
import {
  fileListFormSchema,
  optionalFileFormSchema,
  optionalRecordId,
  requiredRecordId,
} from "#lib/form-schemas";
import type { AdminMessageAccessor } from "#lib/messages";

import {
  readPageUploadForm,
  refuse,
  respond,
  signInAgain,
} from "./_lib/page-upload-request";

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
  const form = await readPageUploadForm(request, {
    maxBytes: EPISODE_PAGES_UPLOAD_MAX_BYTES,
    tooLarge: (t) => t("admin.series.episodes.validation.upload_too_large"),
  });
  if ("response" in form) {
    return form.response;
  }
  const { formData, locale, t, tenantId } = form;

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
