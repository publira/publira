import type { Locale } from "@publira/i18n";
import { formatList } from "@publira/utils";

import type { CreatorCredit } from "./catalog";
import type { HostMessageAccessor } from "./messages";

/**
 * What a share says in words: the work, and who is credited on it.
 *
 * It names the work rather than the page, on every screen a share leaves from.
 * The address carries which page it was, and the card that unfurls from it
 * names the episode, so the one thing neither of those holds is the work a
 * reader would recognise it by, and the people credited on it.
 *
 * A work nobody is credited on is its own name and nothing else, rather than a
 * name followed by an empty bracket. The names are joined the way the reader's
 * language joins a list, so the sentence the catalog holds is the wording
 * around them and nothing else.
 */
export const shareText = (
  t: HostMessageAccessor,
  locale: Locale,
  title: string,
  credits: readonly CreatorCredit[]
): string => {
  const names = credits.map((credit) => credit.name);
  if (names.length === 0) {
    return title;
  }

  return t("host.share.text", {
    creators: formatList(names, { locale }),
    title,
  });
};
