import type { EyeCatchVariantItem } from "#components/eye-catch/types";
import type { LabelDeletionReference } from "#lib/label";

export interface LabelListItem {
  /** The primary key an edit addresses the label by. */
  id: string;
  /** What the label's page is addressed by in the URL. */
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
    }
  | null;

/**
 * A deletion the API refused, with the screen that holds what refers to the
 * label. A deletion that goes through leaves the screen instead of answering.
 */
export type LabelDeleteActionState = {
  ok: false;
  message: string;
  reference?: LabelDeletionReference;
} | null;
