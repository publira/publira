import { toFormDataInput } from "@publira/utils/form-data";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { isUnauthenticatedError } from "#lib/admin-auth-shared";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import { episodesCacheTag } from "#lib/episode";
import { EPISODE_PAGES_UPLOAD_MAX_BYTES } from "#lib/episode-pages-upload";
import { optionalFileFormSchema } from "#lib/form-schemas";
import {
  readPageUploadForm,
  refuse,
  respond,
  signInAgain,
} from "#lib/page-upload-request";
import { getTenantCurrency } from "#lib/public-api";
import { seriesCacheTag, seriesListCacheTag } from "#lib/series";
import { runSeriesImport } from "#lib/series-import";
import {
  checkSeriesImport,
  seriesImportProblemText,
} from "#lib/series-import-manifest";

const importFormSchema = z.object({
  archive: optionalFileFormSchema,
  // Set by a series' episode list, the only series that screen may add to.
  seriesPublicId: z
    .string()
    .trim()
    .transform((value) => value || undefined)
    .optional()
    .catch(undefined),
});

/**
 * Imports a series and its episodes from a ZIP of page images and a manifest.
 *
 * What it checks before it reads the body is what the page upload checks, by
 * the same code, and for the reason that upload is a Route Handler
 * (`lib/episode-pages-upload.ts`). Nothing is created until the manifest has
 * been checked against the ZIP again here: the screen's check is for the
 * operator, this one is the one that holds.
 *
 * An import that ran answers 200 however far it got, with one row per episode.
 * Every tag it may have touched is expired whether or not it finished.
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

  const parsed = importFormSchema.safeParse(
    toFormDataInput(formData, {
      archive: { kind: "file", name: "archive" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
    })
  );

  if (!parsed.success || !parsed.data.archive) {
    return refuse(t("admin.series.episodes.validation.zip_required"), 400);
  }

  const { archive, seriesPublicId } = parsed.data;

  const currency = await getTenantCurrency(tenantId);

  if (!currency) {
    return refuse(t("admin.series.episodes.currency_unavailable"), 503);
  }

  const zip = new Uint8Array(await archive.arrayBuffer());
  const check = checkSeriesImport(zip, { currency, seriesPublicId });

  if (!check.ok) {
    return respond(
      {
        message: t("admin.series.import.refused"),
        ok: false,
        problems: check.problems.map((problem) =>
          seriesImportProblemText(t, problem)
        ),
      },
      422
    );
  }

  let outcome: Awaited<ReturnType<typeof runSeriesImport>>;

  try {
    outcome = await runSeriesImport(check.plan, {
      currency,
      locale,
      tenantId,
      zip,
    });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return signInAgain(request, t);
    }

    throw error;
  }

  if (!outcome.ok) {
    return refuse(
      "message" in outcome ? outcome.message : t("admin.series.not_found"),
      422
    );
  }

  const { rows, seriesPublicId: importedPublicId } = outcome;

  // The screen refreshes once this answers, so nothing it reads may be served
  // stale; `updateTag` would say the same, but it is for Server Actions only.
  revalidateTag(seriesListCacheTag(tenantId), { expire: 0 });
  revalidateTag(seriesCacheTag(tenantId, importedPublicId), { expire: 0 });
  revalidateTag(episodesCacheTag(tenantId), { expire: 0 });
  revalidateTag(tenantDashboardCacheTag(tenantId), { expire: 0 });

  const finished = rows.every((row) => row.status === "imported");

  return respond(
    {
      message: finished
        ? t("admin.series.import.finished", { count: rows.length })
        : t("admin.series.import.stopped"),
      ok: finished,
      rows,
      seriesPublicId: importedPublicId,
    },
    200
  );
};
