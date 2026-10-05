import type { CachedReadResult } from "@publira/utils/cached-read";

import type { SeriesWaitFreeRule } from "#lib/catalog";
import type { WaitFreeTicketState } from "#lib/wait-free";

/**
 * What the access gate says about wait-for-free on a locked episode, in the
 * five states it can be in. Absent on a series without the rule, and on an
 * episode the reader's ticket state was not read for.
 */
export type WaitFreeOffer =
  /** One of the latest episodes, which the rule keeps a ticket off. */
  | { kind: "excluded" }
  /** A guest, who has to sign in before a ticket is theirs to use. */
  | { kind: "guest" }
  /** The reader's ticket is ready, and opens the episode for `accessHours`. */
  | { accessHours: number; kind: "ready" }
  /** The reader used their ticket and the next one is not ready yet. */
  | { accessHours: number; kind: "recharging"; nextAvailableAt: string }
  /** The reader's ticket state could not be read. */
  | { kind: "unavailable"; message: string };

/** Whether a ticket may open this episode at all, before asking the reader. */
export const waitFreeEpisodeEligible = (
  rule: SeriesWaitFreeRule | undefined,
  episodeId: string
): rule is SeriesWaitFreeRule =>
  rule !== undefined && !rule.excludedEpisodeIds.includes(episodeId);

/**
 * The offer for a locked episode, from the series' rule and — for a signed-in
 * reader on an episode a ticket may open — their ticket state.
 *
 * `ticketState` is `undefined` for a guest. A state that resolved to `null`
 * means the API has nothing to offer this reader after all (the rule was
 * turned off after the series page was cached), so the gate says nothing.
 */
export const toWaitFreeOffer = ({
  episodeId,
  rule,
  ticketState,
}: {
  episodeId: string;
  rule: SeriesWaitFreeRule | undefined;
  ticketState: CachedReadResult<WaitFreeTicketState | null> | undefined;
}): WaitFreeOffer | undefined => {
  if (!rule) {
    return undefined;
  }
  if (!waitFreeEpisodeEligible(rule, episodeId)) {
    return { kind: "excluded" };
  }
  if (!ticketState) {
    return { kind: "guest" };
  }
  if (!ticketState.ok) {
    return { kind: "unavailable", message: ticketState.message };
  }
  if (!ticketState.value) {
    return undefined;
  }
  return ticketState.value.ready
    ? { accessHours: rule.accessHours, kind: "ready" }
    : {
        accessHours: rule.accessHours,
        kind: "recharging",
        nextAvailableAt: ticketState.value.nextAvailableAt,
      };
};
