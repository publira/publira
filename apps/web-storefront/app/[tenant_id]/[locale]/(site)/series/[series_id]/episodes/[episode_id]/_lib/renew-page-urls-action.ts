"use server";

import { z } from "zod";

import { resolveAccessToken } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import { renewEpisodeImageUrls } from "#lib/catalog";
import { localeFormSchema } from "#lib/locale-form";

const publicIdSchema = z.string().trim().min(1).max(64);

const renewPageUrlsInputSchema = z.object({
  episodePublicId: publicIdSchema,
  locale: localeFormSchema,
  seriesPublicId: publicIdSchema,
  tenantId: tenantIdSchema,
});

/**
 * Fresh image URLs for the reader's open viewer, by image id, for pages whose
 * URLs' media tokens expired before the reader reached them. An empty answer
 * leaves those pages failed, with their reload control.
 */
export const renewEpisodePageUrlsAction = async (
  tenantId: unknown,
  locale: unknown,
  seriesPublicId: unknown,
  episodePublicId: unknown
): Promise<Record<string, string>> => {
  // This Server Action only reads; the same-origin check applies to mutations.
  const parsed = renewPageUrlsInputSchema.safeParse({
    episodePublicId,
    locale,
    seriesPublicId,
    tenantId,
  });
  if (!parsed.success) {
    return {};
  }

  return await renewEpisodeImageUrls({
    ...parsed.data,
    accessToken: await resolveAccessToken(),
  });
};
