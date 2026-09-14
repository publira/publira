import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { FollowUpdate } from "@publira/api-client/public/types";
import type { Locale } from "@publira/i18n";

import type { RestrictedAgeRating } from "./age-rating";
import { withRestrictedAgeRating } from "./age-rating";
import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { toEyeCatchImageVariants } from "./catalog";
import type { EyeCatchImageVariant } from "./catalog";
import { getMessagesFor } from "./messages";

const defaultFollowUpdatesLimit = 6;

export interface FollowUpdateItem {
  episode: {
    orderIndex: number;
    publicId: string;
    /** When the episode was published, as RFC 3339. */
    publishedAt: string;
    title: string;
  };
  series: {
    ageRating?: RestrictedAgeRating;
    eyeCatchImageVariants?: EyeCatchImageVariant[];
    publicId: string;
    title: string;
  };
}

export type ListMyFollowUpdatesResult =
  | { ok: true; updates: FollowUpdateItem[] }
  | { message: string; ok: false; requiresSignIn: boolean };

export interface ListMyFollowUpdatesInput {
  limit?: number;
  /** UI locale the failure wording is written in. */
  locale: Locale;
}

/**
 * The generated `FollowUpdate` fields {@link mapFollowUpdate} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type keeps compiling, and the section then renders rows
 * with a blank title linking to an empty episode ID.
 */
type RawFollowUpdate = Pick<FollowUpdate, "episode" | "series">;

const mapFollowUpdate = (update: RawFollowUpdate): FollowUpdateItem | null => {
  const episodePublicId = update.episode?.publicId?.trim() ?? "";
  const seriesPublicId = update.series?.publicId?.trim() ?? "";
  if (!(episodePublicId && seriesPublicId)) {
    return null;
  }

  return {
    episode: {
      orderIndex: update.episode?.orderIndex ?? 0,
      publicId: episodePublicId,
      publishedAt: update.episode?.publishedAt ?? "",
      title: update.episode?.title ?? "",
    },
    series: withRestrictedAgeRating(
      {
        eyeCatchImageVariants: toEyeCatchImageVariants(
          update.series?.eyeCatchImageVariants
        ),
        publicId: seriesPublicId,
        title: update.series?.title ?? "",
      },
      update.series?.ageRating
    ),
  };
};

/**
 * The episodes that have arrived in what the signed-in reader follows, newest
 * first.
 *
 * Uncached, because it is one reader's own answer and it changes the moment
 * they follow something or an episode of theirs is published.
 *
 * A session the API rejects is reported as `requiresSignIn` rather than as an
 * empty list: the two are different answers, and only one of them belongs to
 * this reader. The screen sends them to sign in again instead of telling
 * someone who follows plenty that nothing is new.
 */
export const listMyFollowUpdates = async (
  tenantId: string,
  input: ListMyFollowUpdatesInput
): Promise<ListMyFollowUpdatesResult> => {
  const { locale } = input;
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.follow.listMyFollowUpdates(
      {
        limit: input.limit ?? defaultFollowUpdatesLimit,
        tenant: { tenantId },
        token: "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      updates: (response.updates ?? []).flatMap((update) => {
        const mapped = mapFollowUpdate(update);
        return mapped ? [mapped] : [];
      }),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("host.my.follow_updates_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isRpcError(error, Code.Unauthenticated),
    };
  }
};
