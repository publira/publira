import type { CreatorCreditSource } from "@publira/api-client/admin/types";

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
