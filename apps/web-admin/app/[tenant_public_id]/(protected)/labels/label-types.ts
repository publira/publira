export interface LabelListItem {
  publicId: string;
  name: string;
}

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
