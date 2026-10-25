export interface TicketSeriesOption {
  id: string;
  publicId: string;
  title: string;
}

export interface TicketEpisodeOption {
  id: string;
  publicId: string;
  title: string;
}

export type ListTicketEpisodeOptionsResult =
  | { episodes: TicketEpisodeOption[]; ok: true }
  | { episodes: TicketEpisodeOption[]; message: string; ok: false };

export interface AccessTicketItem {
  createdAt: string;
  episodePublicId: string;
  episodeTitle: string;
  expiresAt: string;
  /** The internal ID RevokeAccessTicket addresses the ticket by. */
  id: string;
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
} | null;
