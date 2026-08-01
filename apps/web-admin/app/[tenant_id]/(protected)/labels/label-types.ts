import type { EyeCatchVariantItem } from "#components/eye-catch/types";

export interface LabelListItem {
  publicId: string;
  name: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: LabelEyeCatchVariantItem[];
}

export type LabelEyeCatchVariantItem = EyeCatchVariantItem;

export type LabelMutationMode = "create" | "update";

export type LabelActionState =
  | {
      ok: false;
      message: string;
      mode: LabelMutationMode;
    }
  | {
      ok: true;
      message: string;
      mode: LabelMutationMode;
      label: LabelListItem;
    }
  | null;
