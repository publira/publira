import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { MyEpisodeRead } from "@publira/api-client/public/types";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { loadHostMessages } from "./messages";

const defaultEpisodeReadsPageSize = 20;

export interface EpisodeReadItem {
  episode: { orderIndex: number; publicId: string; title: string };
  /** When the reader first finished the episode, as RFC 3339. */
  readAt: string;
  series: { publicId: string; title: string };
}

export type ListEpisodeReadsResult =
  | {
      nextToken: string;
      ok: true;
      previousToken: string;
      reads: EpisodeReadItem[];
    }
  | {
      message: string;
      nextToken: string;
      ok: false;
      previousToken: string;
      reads: EpisodeReadItem[];
      requiresSignIn: boolean;
    };

export interface ListEpisodeReadsInput {
  limit?: number;
  /** UI locale the failure wording is written in. */
  locale: Locale;
  token?: string;
}

const emptyEpisodeReadPage = {
  nextToken: "",
  previousToken: "",
  reads: [] as EpisodeReadItem[],
};

/**
 * The generated `MyEpisodeRead` fields {@link mapEpisodeRead} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type keeps compiling, and the history then renders rows
 * with a blank title linking to an empty episode ID, with nothing naming the
 * cause.
 */
type RawEpisodeRead = Pick<MyEpisodeRead, "episode" | "readAt" | "series">;

const mapEpisodeRead = (read: RawEpisodeRead): EpisodeReadItem => ({
  episode: {
    orderIndex: read.episode?.orderIndex ?? 0,
    publicId: read.episode?.publicId ?? "",
    title: read.episode?.title ?? "",
  },
  readAt: read.readAt ?? "",
  series: {
    publicId: read.series?.publicId ?? "",
    title: read.series?.title ?? "",
  },
});

/**
 * One page of the signed-in reader's reading history, most recently finished
 * first.
 *
 * Uncached, unlike the purchases list beside it on `/my`. What changes this
 * answer is the beacon the viewer sends when a reader reaches the last page, so
 * a reader who finishes an episode and opens this page has no Server Action in
 * between that could drop a stored entry; a reused one would keep telling them
 * they have read nothing.
 *
 * A session the API rejects is reported as `requiresSignIn` rather than as an
 * empty history, because the two are different answers and only one of them is
 * this reader's own: the page sends them to sign in again instead of showing
 * the empty state to someone who has read plenty.
 */
export const listMyEpisodeReads = async (
  tenantId: string,
  input: ListEpisodeReadsInput
): Promise<ListEpisodeReadsResult> => {
  const { locale } = input;
  const [messages, sessionId] = await Promise.all([
    loadHostMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      ...emptyEpisodeReadPage,
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.episodeRead.listMyEpisodeReads(
      {
        limit: input.limit ?? defaultEpisodeReadsPageSize,
        tenant: { tenantId },
        token: input.token ?? "",
      },
      buildSessionHeaders(sessionId)
    );
    return {
      nextToken: response.nextToken ?? "",
      ok: true,
      previousToken: response.previousToken ?? "",
      reads: (response.reads ?? []).map(mapEpisodeRead),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      ...emptyEpisodeReadPage,
      message: rpcErrorMessage(
        error,
        getMessage(messages, "host.my.history_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isRpcError(error, Code.Unauthenticated),
    };
  }
};
