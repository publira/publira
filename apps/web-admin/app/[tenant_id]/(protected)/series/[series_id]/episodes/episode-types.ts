import type { EpisodeItem, UnchangedEpisodeCreditItem } from "#lib/episode";

export type EpisodeMutationMode = "create";

export type EpisodeActionState =
  | {
      ok: false;
      message: string;
      mode: EpisodeMutationMode;
    }
  | {
      ok: true;
      message: string;
      mode: EpisodeMutationMode;
      episode: EpisodeItem;
    }
  | null;

export interface EpisodeCreditRangeOption {
  id: string;
  publicId: string;
  title: string;
}

export interface CreditPickerOption {
  id: string;
  name: string;
}

export interface ListEpisodeCreditRangeCatalogResult {
  creatorRoles: CreditPickerOption[];
  creatorRolesErrorMessage?: string;
  creators: CreditPickerOption[];
  creatorsErrorMessage?: string;
  episodes: EpisodeCreditRangeOption[];
  episodesErrorMessage?: string;
}

export type BulkEditEpisodeCreditsActionState =
  | {
      ok: true;
      changedEpisodeIds: string[];
      unchangedEpisodes: UnchangedEpisodeCreditItem[];
    }
  | { ok: false; message: string }
  | null;
