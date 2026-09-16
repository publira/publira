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
  publicId: string;
  title: string;
}

export interface CreditPickerOption {
  publicId: string;
  name: string;
}

export type ListEpisodeCreditRangeOptionsResult =
  | { ok: true; episodes: EpisodeCreditRangeOption[] }
  | { ok: false; episodes: []; message: string };

export type BulkEditEpisodeCreditsActionState =
  | {
      ok: true;
      changedEpisodePublicIds: string[];
      unchangedEpisodes: UnchangedEpisodeCreditItem[];
    }
  | { ok: false; message: string }
  | null;
