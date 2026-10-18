/** Result of a reorder, which the list submits rather than a form. */
export interface VolumeReorderResult {
  ok: boolean;
  message?: string;
}

/** An episode of the series, as a volume's episode list names it. */
export interface VolumeEpisodeOption {
  id: string;
  title: string;
  /** Where the episode stands in the series, 1-based, as its list shows it. */
  position: number;
}
