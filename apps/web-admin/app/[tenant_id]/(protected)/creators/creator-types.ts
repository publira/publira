export interface CreatorListItem {
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: number;
  iconImageUpdatedAt: string;
}

export type CreatorMutationMode = "create" | "update";

export type CreatorActionState =
  | {
      ok: false;
      message: string;
      mode: CreatorMutationMode;
    }
  | {
      ok: true;
      message: string;
      mode: CreatorMutationMode;
      creator: CreatorListItem;
    }
  | null;
