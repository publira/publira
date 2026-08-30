"use server";

import { getMessage } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionMessages } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  reorderEpisodeImages,
  updateEpisodePublishSchedule,
  uploadEpisodePages,
} from "#lib/episode";
import {
  fileListFormSchema,
  jsonStringArrayFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import type { AdminMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  EpisodeEditActionState,
  EpisodeEditMode,
} from "../episode-edit-types";

const hiddenParamsSchema = (messages: AdminMessages) =>
  z.object({
    episodePublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.episode_missing")
    ),
    seriesPublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.tenant_missing")
    ),
  });

const scheduleFormSchema = (messages: AdminMessages) =>
  hiddenParamsSchema(messages).extend({
    publishAt: optionalTrimmedString(),
  });

const uploadModeSchema = z.preprocess(
  (value) => {
    if (value === "zip" || value === "epub" || value === "pages") {
      return value;
    }

    return "pages";
  },
  z.enum(["pages", "zip", "epub"])
);

const uploadPagesFormSchema = (messages: AdminMessages) =>
  hiddenParamsSchema(messages).extend({
    archive: optionalFileFormSchema,
    pages: fileListFormSchema,
    uploadMode: uploadModeSchema,
  });

const reorderImagesSchema = (messages: AdminMessages) =>
  z.object({
    episodePublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.sort_data_missing")
    ),
    orderedImageIds: jsonStringArrayFormSchema,
    seriesPublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.sort_data_missing")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.sort_data_missing")
    ),
  });

const hiddenFormFields = {
  episodePublicId: { kind: "value", name: "episode_public_id" },
  seriesPublicId: { kind: "value", name: "series_public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toFailure = (
  message: string,
  mode: EpisodeEditMode
): { message: string; mode: EpisodeEditMode; ok: false } => ({
  message,
  mode,
  ok: false,
});

const parsePublishAtToRFC3339 = async (
  value: string,
  tenantId: string,
  messages: AdminMessages
): Promise<{ ok: true; iso: string } | ReturnType<typeof toFailure>> => {
  if (!value) {
    return { iso: "", ok: true };
  }

  // The form posts an absolute instant resolved against the zone it was
  // rendered in. A leftover `datetime-local` wall clock (no JS) is still
  // accepted and read in the tenant's current display zone.
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const iso = toInstantIsoString(value, timeZone);
  const parsed = parseInstant(iso);
  if (!parsed) {
    return toFailure(
      getMessage(
        messages,
        "admin.series.episodes.validation.publish_at_invalid"
      ),
      "schedule"
    );
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toFailure(
      getMessage(
        messages,
        "admin.series.episodes.validation.publish_at_future"
      ),
      "schedule"
    );
  }

  return { iso, ok: true };
};

export const updateEpisodeScheduleAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const messages = await getActionMessages(formData);
  const parsed = scheduleFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      publishAt: { kind: "value", name: "publish_at" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "schedule");
  }

  const schedule = await parsePublishAtToRFC3339(
    parsed.data.publishAt,
    parsed.data.tenantId,
    messages
  );
  if (!schedule.ok) {
    return schedule;
  }

  const result = await withAdminSessionReauth(() =>
    updateEpisodePublishSchedule({
      episodePublicId: parsed.data.episodePublicId,
      publishAt: schedule.iso,
      tenantId: parsed.data.tenantId,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "schedule");
  }

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?schedule_updated=1`
  );
};

export const uploadEpisodePagesAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const messages = await getActionMessages(formData);
  const parsed = uploadPagesFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      archive: { kind: "file", name: "archive" },
      pages: { kind: "files", name: "pages" },
      uploadMode: { kind: "value", name: "upload_mode" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "pages");
  }

  const {
    archive,
    episodePublicId,
    pages,
    seriesPublicId,
    tenantId,
    uploadMode,
  } = parsed.data;

  if (uploadMode === "zip" || uploadMode === "epub") {
    if (!archive) {
      return toFailure(
        uploadMode === "zip"
          ? getMessage(
              messages,
              "admin.series.episodes.validation.zip_required"
            )
          : getMessage(
              messages,
              "admin.series.episodes.validation.epub_required"
            ),
        "pages"
      );
    }

    const normalizedName = archive.name.toLowerCase();
    const mime = archive.type.toLowerCase();
    const isValidArchive =
      uploadMode === "zip"
        ? mime === "application/zip" || normalizedName.endsWith(".zip")
        : mime.includes("application/epub+zip") ||
          normalizedName.endsWith(".epub");

    if (!isValidArchive) {
      return toFailure(
        uploadMode === "zip"
          ? getMessage(messages, "admin.series.episodes.validation.zip_invalid")
          : getMessage(
              messages,
              "admin.series.episodes.validation.epub_invalid"
            ),
        "pages"
      );
    }

    const result = await withAdminSessionReauth(() =>
      uploadEpisodePages({
        archive,
        episodePublicId,
        seriesPublicId,
        tenantId,
      })
    );

    if (!result.ok) {
      return toFailure(result.message, "pages");
    }

    redirect(
      `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
    );
  }

  if (pages.length === 0) {
    return toFailure(
      getMessage(messages, "admin.series.episodes.validation.pages_required"),
      "pages"
    );
  }

  const result = await withAdminSessionReauth(() =>
    uploadEpisodePages({
      episodePublicId,
      pages,
      tenantId,
    })
  );

  if (!result.ok) {
    return toFailure(result.message, "pages");
  }

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
  );
};

export const reorderEpisodeImagesAction = async (formData: FormData) => {
  "use server";

  await assertSameOrigin();
  const messages = await getActionMessages(formData);
  const parsed = reorderImagesSchema(messages).safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      orderedImageIds: { kind: "value", name: "ordered_image_ids" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: getMessage(
          messages,
          "admin.series.episodes.validation.sort_data_missing"
        ),
      }),
      ok: false,
    };
  }

  if (parsed.data.orderedImageIds.length === 0) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.no_images_to_sort"
      ),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderEpisodeImages({
      episodePublicId: parsed.data.episodePublicId,
      imageIds: parsed.data.orderedImageIds,
      tenantId: parsed.data.tenantId,
    })
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
  };
};
