"use server";

import { validationErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { returnToFormSchema, tenantIdSchema } from "./auth-input";
import { requirePublicSession, withPublicSessionReauth } from "./auth-session";
import { tenantSeriesDetailTag, tenantSeriesTag } from "./cache-tags";
import { assertSameOrigin } from "./csrf";
import {
  episodeRatingsCacheTag,
  MAX_EPISODE_REACTION_SCORE,
  rateEpisode,
} from "./episode-rating";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "./locale-form";

export type RateEpisodeActionState =
  | { ok: true; ratingCount: number; score: number }
  | { message: string; ok: false }
  | null;

const publicIdFormSchema = z.string().trim().min(1).max(64);

const rateEpisodeFormSchema = z.object({
  episodePublicId: publicIdFormSchema,
  locale: localeFormSchema,
  presses: z.coerce.number().int().min(1).max(MAX_EPISODE_REACTION_SCORE),
  returnTo: returnToFormSchema,
  seriesPublicId: publicIdFormSchema,
  tenantId: tenantIdSchema,
});

export const rateEpisodeAction = async (
  _prevState: RateEpisodeActionState,
  formData: FormData
): Promise<RateEpisodeActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const parsed = rateEpisodeFormSchema.safeParse(
    toFormDataInput(formData, {
      episodePublicId: "value",
      locale: "value",
      presses: "value",
      returnTo: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return { message: validationErrorMessage(submittedLocale), ok: false };
  }

  const {
    episodePublicId,
    locale,
    presses,
    returnTo,
    seriesPublicId,
    tenantId,
  } = parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () => rateEpisode({ episodePublicId, locale, presses, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(episodeRatingsCacheTag(tenantId));
  // The public episode read carries the headcount, so other readers see the
  // new tally once this press lands rather than when the catalog entry ages.
  updateTag(tenantSeriesDetailTag(tenantId));
  updateTag(tenantSeriesTag(tenantId, seriesPublicId));
  return {
    ok: true,
    ratingCount: result.ratingCount,
    score: result.score,
  };
};
