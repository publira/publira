import type { CreatorCreditSource } from "@publira/api-client/admin/types";

import type { EpisodeDeletionReference } from "#lib/episode";

export interface EpisodeCreatorCredit {
  creatorId: string;
  roleId: string;
  /** Basis points: 10000 is 100%. */
  shareBps: number;
  source: CreatorCreditSource;
}

export type EpisodeEditActionState = {
  ok: boolean;
  message: string;
} | null;

/**
 * A deletion the API refused, with the list that holds what refers to the
 * episode when one does. A deletion that goes through leaves the screen
 * instead of answering.
 */
export type EpisodeDeleteActionState = {
  ok: false;
  message: string;
  reference?: EpisodeDeletionReference;
} | null;
