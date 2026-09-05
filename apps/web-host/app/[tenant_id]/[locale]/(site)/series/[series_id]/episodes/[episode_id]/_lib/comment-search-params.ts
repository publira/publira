import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";

/**
 * The comment section pages within the episode page, so its cursor cannot be
 * the bare `token` every list route uses: the episode URL already carries the
 * Checkout parameters, and a second list here later would collide with it.
 */
export const COMMENT_TOKEN_PARAM = "comments";

const commentSearchParamsSchema = z.object({
  [COMMENT_TOKEN_PARAM]: cursorTokenSchema,
});

export type CommentSearchParams = z.output<typeof commentSearchParamsSchema>;

export const parseCommentSearchParams = (input: unknown): CommentSearchParams =>
  commentSearchParamsSchema.parse(input);

/**
 * The episode page again, at one page of its comment list. An empty token
 * drops the parameter, i.e. back to the newest comments, and the link keeps
 * the reader's place by ending on the section's own anchor.
 */
export const episodeCommentsHref = (
  episodePath: string,
  token: string
): string =>
  token
    ? `${episodePath}?${COMMENT_TOKEN_PARAM}=${encodeURIComponent(token)}#comments`
    : `${episodePath}#comments`;
