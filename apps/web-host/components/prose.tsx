import type { Locale } from "@publira/i18n";
import { cn } from "@publira/utils";

/**
 * A paragraph of the catalogue's own writing: a synopsis, a creator's profile.
 *
 * It is set the way the design sets text meant to be read rather than scanned
 * — the serif face, one of the two reading line heights, and the forty-
 * character measure — so a synopsis on a series page reads like the opening of
 * the work rather than like a field of a record.
 *
 * The line height follows the reader's locale. Which of the two a passage
 * wants is a question about the script it is set in, and the catalogue records
 * no language of its own; the locale the reader chose is the only script
 * signal the page has, and it is the right one wherever a tenant publishes in
 * the language its readers browse in.
 */
export const Prose = ({
  children,
  locale,
}: {
  children: string;
  locale: Locale;
}) => (
  <p
    className={cn(
      "max-w-(--measure-prose) font-serif whitespace-pre-wrap",
      locale === "en"
        ? "leading-(--leading-reading-latin)"
        : "leading-(--leading-reading-cjk)"
    )}
  >
    {children}
  </p>
);
