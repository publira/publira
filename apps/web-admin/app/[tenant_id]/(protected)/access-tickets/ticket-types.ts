export interface AccessTicketItem {
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  note: string;
  publicId: string;
  revokedAt: string;
  seriesPublicId: string;
  seriesTitle: string;
  status: string;
  userEmail: string;
  userName: string;
  userPublicId: string;
}

export type IssueAccessTicketActionState = {
  message: string;
  ok: boolean;
} | null;

export type RevokeAccessTicketActionState = {
  message: string;
  ok: boolean;
  publicId?: string;
} | null;
