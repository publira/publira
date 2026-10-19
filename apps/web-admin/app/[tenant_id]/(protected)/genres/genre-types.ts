import type { EyeCatchVariantItem } from "#components/eye-catch/types";
import type { GenreTranslationItem } from "#lib/genre";

/** One row of the genre list, in the order the tenant put its genres in. */
export interface GenreListItem {
  /** The primary key every genre write addresses the genre by. */
  id: string;
  /** What the genre's page is addressed by in the URL. */
  publicId: string;
  /** The name in the tenant's default language, which the list shows. */
  name: string;
  /** Every name the genre has, oldest first. */
  translations: GenreTranslationItem[];
  slug: string;
  eyeCatchImageUpdatedAt: string;
  eyeCatchImageVariants: EyeCatchVariantItem[];
}

/** Result of a reorder, which the list submits rather than a form. */
export interface GenreReorderResult {
  ok: boolean;
  message?: string;
}
