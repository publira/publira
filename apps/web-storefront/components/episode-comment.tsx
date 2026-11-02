import { UserIcon } from "@publira/icons";
import { Badge } from "@publira/ui-components/badge";
import type { ReactNode } from "react";

import { AccountIcon } from "#components/account-icon";
import { LocaleLink } from "#components/locale-link";
import type { EpisodeCommentItem } from "#lib/comments";

/**
 * One published comment, drawn the same wherever it is listed: under its
 * episode, and on the Author's page that gathers the comments on all their
 * episodes. The caller writes the list item around it, and places the
 * controls it offers beside the author in `Header`.
 */
const EpisodeCommentRoot = ({ children }: { children: ReactNode }) => (
  <div>{children}</div>
);

/** The author on one side and the caller's controls on the other. */
const EpisodeCommentHeader = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    {children}
  </div>
);

/** Who wrote the comment: their `Icon` beside a `Byline`. */
const EpisodeCommentAuthor = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 items-start gap-3">{children}</div>
);

/**
 * The icon the author's account shows now, and a person glyph when it shows
 * none, so a list with and without icons keeps one column of faces beside the
 * names. The name beside it says whose icon it is, so the image itself says
 * nothing.
 */
const EpisodeCommentIcon = ({
  icon,
}: {
  icon: EpisodeCommentItem["authorIcon"];
}) => (
  <AccountIcon
    alt=""
    className="size-10 shrink-0 rounded-full border border-border object-cover"
    fallback={
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
        <UserIcon aria-hidden="true" className="size-5 text-muted-foreground" />
      </span>
    }
    icon={icon}
    size={40}
  />
);

/** The `Name` line above the `Meta` line. */
const EpisodeCommentByline = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0">{children}</div>
);

/** The author's name, and the `CreatorBadge` when the episode credits them. */
const EpisodeCommentName = ({ children }: { children: ReactNode }) => (
  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
    {children}
  </p>
);

/**
 * The name of one of the episode's credited creators, linked to their page:
 * it is the one name in the list a reader may want to follow, so a reader's
 * name stays plain text.
 */
const EpisodeCommentCreatorLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <LocaleLink className="text-primary underline underline-offset-4" href={href}>
    {children}
  </LocaleLink>
);

/**
 * Says in words that one of the episode's credited creators wrote the comment.
 * The badge is the whole of the mark, so a reader who cannot tell its colour
 * apart still reads it.
 */
const EpisodeCommentCreatorBadge = ({ children }: { children: ReactNode }) => (
  <Badge tone="info">{children}</Badge>
);

/** The date, and whatever else the caller says about the comment. */
const EpisodeCommentMeta = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

const EpisodeCommentBody = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 text-sm whitespace-pre-wrap">{children}</p>
);

export {
  EpisodeCommentAuthor as Author,
  EpisodeCommentBody as Body,
  EpisodeCommentByline as Byline,
  EpisodeCommentCreatorBadge as CreatorBadge,
  EpisodeCommentCreatorLink as CreatorLink,
  EpisodeCommentHeader as Header,
  EpisodeCommentIcon as Icon,
  EpisodeCommentMeta as Meta,
  EpisodeCommentName as Name,
  EpisodeCommentRoot as Root,
};
