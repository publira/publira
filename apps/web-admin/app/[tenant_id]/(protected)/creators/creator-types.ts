export interface CreatorListItem {
  /** The primary key an edit addresses the creator by. */
  id: string;
  /** What the creator's page is addressed by in the URL. */
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
