import type { CreatorCreditSource } from "@publira/api-client/admin/types";

export interface EpisodeCreatorCredit {
  creatorPublicId: string;
  rolePublicId: string;
  source: CreatorCreditSource;
}

export type EpisodeEditMode = "credits" | "schedule" | "pages";

export type EpisodeEditActionState =
  | {
      ok: false;
      message: string;
      mode: EpisodeEditMode;
    }
  | {
      ok: true;
      message: string;
      mode: EpisodeEditMode;
    }
  | null;
