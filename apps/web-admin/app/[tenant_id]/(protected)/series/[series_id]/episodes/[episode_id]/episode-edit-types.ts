export type EpisodeEditMode = "schedule" | "pages" | "layout";

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
