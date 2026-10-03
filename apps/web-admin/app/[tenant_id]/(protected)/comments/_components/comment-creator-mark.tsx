import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { CommentCreator } from "../comment-types";

/**
 * Marks a comment written by a creator the episode credits, under the name the
 * episode credits them as.
 *
 * It is what a moderator reads before removing the comment: the author's own
 * word on their work looks like any other reader's otherwise. The badge uses
 * the word the storefront puts on the same comment, so staff and readers call
 * it the same thing, and it is the whole of the mark in words rather than in
 * colour. Every other comment renders nothing.
 */
export const CommentCreatorMark = ({
  creator,
}: {
  creator: CommentCreator | null;
}) => {
  if (!creator) {
    return null;
  }

  const name = creator.name || creator.publicId;

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Badge tone="info">
        <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
          <Message message="admin.comments.creator_badge" />
        </Suspense>
      </Badge>
      {creator.publicId ? (
        <Link
          className="underline-offset-4 hover:underline"
          href={`/creators/${creator.publicId}`}
        >
          {name}
        </Link>
      ) : (
        <span>{name}</span>
      )}
    </span>
  );
};
