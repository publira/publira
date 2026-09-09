/** One row of the genre list, in the order the tenant put its genres in. */
export interface GenreListItem {
  publicId: string;
  name: string;
  slug: string;
}

/**
 * Action state for a write aimed at one genre.
 *
 * Rename and delete are rendered once per row and share a screen, so the state
 * carries the genre it answers: without it every row would show the message the
 * one that submitted produced.
 */
export type GenreRowActionState = {
  ok: boolean;
  message: string;
  publicId: string;
} | null;

/** Result of a reorder, which the list submits rather than a form. */
export interface GenreReorderResult {
  ok: boolean;
  message?: string;
}
