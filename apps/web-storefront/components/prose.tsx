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
 * `locale` is the language the passage is written in, which the paragraph
 * names as its `lang` and which picks its line height: which of the two a
 * passage wants is a question about the script it is set in. A synopsis names
 * the locale of the translation it was served from. A creator's profile records
 * no language of its own, so it passes the reader's, the only script signal
 * that page has.
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
      "max-w-measure-prose font-serif whitespace-pre-wrap",
      locale === "en"
        ? "leading-(--leading-reading-latin)"
        : "leading-(--leading-reading-cjk)"
    )}
    lang={locale}
  >
    {children}
  </p>
);
