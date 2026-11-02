import { UserIcon } from "@publira/icons";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { AccountIcon } from "#components/account-icon";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { episodeCommentDisplayName } from "#lib/comments";
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

/**
 * Who wrote the comment, with `children` — the date, and whatever else the
 * caller says about the comment — in a line under the name.
 *
 * A comment by one of the episode's credited creators is shown under the name
 * the episode credits them as, with a badge saying so in words: the badge is
 * the whole of the mark, so a reader who cannot tell its colour apart still
 * reads it. That name links to the creator's page, since it is the one name in
 * the list a reader may want to follow; a reader's name stays plain text.
 *
 * Every author is drawn with the icon their account shows now, and with a
 * person glyph when it shows none, so a list with and without icons keeps one
 * column of faces beside the names.
 */
const EpisodeCommentAuthor = ({
  children,
  comment,
}: {
  children: ReactNode;
  comment: Pick<
    EpisodeCommentItem,
    "authorIcon" | "authorName" | "creatorName" | "creatorPublicId"
  >;
}) => (
  <div className="flex min-w-0 items-start gap-3">
    {/* The name beside it says whose icon it is, so the image itself says
        nothing. */}
    <AccountIcon
      alt=""
      className="size-10 shrink-0 rounded-full border border-border object-cover"
      fallback={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
          <UserIcon
            aria-hidden="true"
            className="size-5 text-muted-foreground"
          />
        </span>
      }
      icon={comment.authorIcon}
      size={40}
    />
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        {comment.creatorPublicId ? (
          <LocaleLink
            className="text-primary underline underline-offset-4"
            href={`/creators/${comment.creatorPublicId}`}
          >
            {episodeCommentDisplayName(comment)}
          </LocaleLink>
        ) : (
          episodeCommentDisplayName(comment)
        )}
        {comment.creatorName ? (
          <Badge tone="info">
            <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
              <Message message="storefront.episode.comments.creator_badge" />
            </Suspense>
          </Badge>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  </div>
);

const EpisodeCommentBody = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 text-sm whitespace-pre-wrap">{children}</p>
);

export {
  EpisodeCommentAuthor as Author,
  EpisodeCommentBody as Body,
  EpisodeCommentHeader as Header,
  EpisodeCommentRoot as Root,
};
