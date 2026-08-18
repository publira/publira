import type { CursorPageTokens } from "#lib/cursor-page";

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string;
  audienceType: "all" | "selected";
  targetUserPublicId: string;
  targetUserName: string;
  createdAt: string;
}

export interface AnnouncementTargetUser {
  publicId: string;
  name: string;
}

export type ListAnnouncementsResult = CursorPageTokens &
  (
    | {
        ok: true;
        announcements: AnnouncementItem[];
      }
    | {
        ok: false;
        message: string;
        announcements: AnnouncementItem[];
        /** The API rejected the session — the page raises the login redirect. */
        requiresSignIn: boolean;
      }
  );

/** Every user the create form can address, or the reason none could be read. */
export type ListAnnouncementTargetUsersResult =
  | {
      ok: true;
      users: AnnouncementTargetUser[];
    }
  | {
      ok: false;
      message: string;
      users: AnnouncementTargetUser[];
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type CreateAnnouncementActionState =
  | {
      ok: false;
      message: string;
    }
  | {
      ok: true;
      message: string;
      createdCount: number;
    }
  | null;
