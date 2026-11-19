import type { CreatorDeletionReference } from "#lib/creator";

export interface CreatorListItem {
  /** The primary key an edit addresses the creator by. */
  id: string;
  /** What the creator's page is addressed by in the URL. */
  publicId: string;
  name: string;
  profileText: string;
  iconImageUrl: string;
  iconImageFileSizeBytes: bigint;
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

/**
 * A deletion the API refused, with the screen to clear the reference from
 * when there is one. A deletion that goes through leaves the screen instead of
 * answering.
 */
export type CreatorDeleteActionState = {
  ok: false;
  message: string;
  reference?: CreatorDeletionReference;
} | null;
