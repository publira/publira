export interface SeriesListItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  labelPublicId: string;
  labelName: string;
  creatorNames: string[];
  creatorPublicIds: string[];
  isPublished: boolean;
}

export type SeriesMutationMode = "create" | "update";

export type SeriesActionState =
  | {
      ok: false;
      message: string;
      mode: SeriesMutationMode;
    }
  | {
      ok: true;
      message: string;
      mode: SeriesMutationMode;
      series: SeriesListItem;
    }
  | null;
