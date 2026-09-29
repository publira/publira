import type { EyeCatchVariantItem } from "#components/eye-catch/types";

/** One row of the genre list, in the order the tenant put its genres in. */
export interface GenreListItem {
  /** The primary key every genre write addresses the genre by. */
  id: string;
  /** What the genre's page is addressed by in the URL. */
  publicId: string;
  name: string;
  slug: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: EyeCatchVariantItem[];
}

/** Result of a reorder, which the list submits rather than a form. */
export interface GenreReorderResult {
  ok: boolean;
  message?: string;
}
