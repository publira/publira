export interface EyeCatchVariantItem {
  variantType: string;
  label: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export type EyeCatchAspectActionState =
  | {
      ok: boolean;
      message: string;
      /** Which ratio the result belongs to, so one slot's message stays in it. */
      variantType: string;
    }
  /**
   * The API refused the image for this ratio. The slot writes the wording
   * itself: the size to name is the minimum it already shows, which the
   * Action knows nothing about beyond the ratio's key.
   */
  | { ok: false; imageInvalid: true; variantType: string }
  | null;
