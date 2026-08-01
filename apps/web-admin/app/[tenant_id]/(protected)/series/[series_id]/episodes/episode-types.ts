import type { EpisodeItem } from "#lib/episode";

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
