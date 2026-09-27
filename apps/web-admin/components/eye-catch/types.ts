export interface EyeCatchVariantItem {
  variantType: string;
  label: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

/** What an upload for one ratio returns; each ratio is a form of its own. */
export type EyeCatchAspectActionState = {
  ok: boolean;
  message: string;
} | null;
