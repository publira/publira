import { cn } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import { creatorPageHref } from "#lib/creator-page-paths";
import type { MyCreatorItem } from "#lib/creator-pages";
import { getMessages } from "#lib/get-messages";

/**
 * One tab per Author the account is linked to, the current one marked as the
 * page. Each tab is a link to that Author's page rather than a panel switched
 * in place, so an Author's page has a URL of its own. An account linked to one
 * Author gets no tab bar: there is nothing to switch to.
 */
export const CreatorTabs = async ({
  creators,
  currentId,
}: {
  creators: readonly MyCreatorItem[];
  currentId: string;
}) => {
  if (creators.length < 2) {
    return null;
  }

  const t = await getMessages();

  return (
    <nav
      aria-label={t("storefront.my_creator.tabs_aria")}
      className="flex gap-1 overflow-x-auto border-b border-border"
    >
      {creators.map((creator) => {
        const isCurrent = creator.id === currentId;

        return (
          <LocaleLink
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              isCurrent
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            href={creatorPageHref(creator.id)}
            key={creator.id}
          >
            {creator.name}
          </LocaleLink>
        );
      })}
    </nav>
  );
};
