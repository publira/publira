import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { isUnauthenticatedError } from "#lib/admin-auth-shared";
import {
  episodeCacheTag,
  episodesCacheTag,
  replaceEpisodeImage,
} from "#lib/episode";
import {
  EPISODE_PAGE_IMAGE_MAX_BYTES,
  EPISODE_PAGE_REPLACE_MAX_BYTES,
} from "#lib/episode-pages-upload";
import { requiredRecordId } from "#lib/form-schemas";
import type { AdminMessageAccessor } from "#lib/messages";

import {
  readPageUploadForm,
  refuse,
  respond,
  signInAgain,
} from "../_lib/page-upload-request";

const replaceFormSchema = (t: AdminMessageAccessor) =>
  z.object({
    episodeId: requiredRecordId(
      t("admin.series.episodes.validation.episode_missing")
    ),
    // An empty file input is read as no file at all.
    image: z.instanceof(File, {
      error: t("admin.series.episodes.validation.image_required"),
    }),
    imageId: requiredRecordId(
      t("admin.series.episodes.validation.image_missing")
    ),
  });

/**
 * Puts the image the episode edit screen submits in the place of one of the
 * episode's pages.
 *
 * It is checked as the page upload beside it is, before the body is read, and
 * held to {@link EPISODE_PAGE_REPLACE_MAX_BYTES}: one page, which may still be
 * twice what a Server Action takes. The answer is JSON for the screen's
 * `fetch`; a success expires the episode's tags, and the screen refreshes
 * itself.
 */
export const POST = async (request: NextRequest) => {
  const form = await readPageUploadForm(request, {
    maxBytes: EPISODE_PAGE_REPLACE_MAX_BYTES,
    tooLarge: (t) => t("admin.series.episodes.image_replace.too_large"),
  });
  if ("response" in form) {
    return form.response;
  }
  const { formData, locale, t, tenantId } = form;

  const parsed = replaceFormSchema(t).safeParse(
    toFormDataInput(formData, {
      episodeId: { kind: "value", name: "episode_id" },
      image: { kind: "file", name: "image" },
      imageId: { kind: "value", name: "image_id" },
    })
  );
  if (!parsed.success) {
    return refuse(toFormErrorMessage(parsed.error, { locale }), 400);
  }
  const { episodeId, image, imageId } = parsed.data;
  // The framing allowance lets a body through with an image a little over
  // what publira server takes, which would be sent for nothing.
  if (image.size > EPISODE_PAGE_IMAGE_MAX_BYTES) {
    return refuse(t("admin.series.episodes.image_replace.too_large"), 413);
  }

  let result: Awaited<ReturnType<typeof replaceEpisodeImage>>;
  try {
    result = await replaceEpisodeImage(
      { episodeId, image, imageId, tenantId },
      locale
    );
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
  revalidateTag(episodeCacheTag(tenantId, episodeId), { expire: 0 });

  return respond(
    { message: t("admin.series.episodes.image_replace.replaced"), ok: true },
    200
  );
};
