export interface EyeCatchVariantItem {
  variantType: string;
  label: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export type EyeCatchAspectActionState = {
  ok: boolean;
  message: string;
  /** Which ratio the result belongs to, so one slot's message stays in it. */
  variantType: string;
} | null;
