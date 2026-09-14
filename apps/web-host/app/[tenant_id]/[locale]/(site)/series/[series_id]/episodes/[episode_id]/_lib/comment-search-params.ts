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
 * drops the parameter, i.e. back to the newest comments.
 *
 * The parameter is what puts the reader back where they were: the viewer opens
 * on the page the comments are read from, and the comments open with it.
 */
export const episodeCommentsHref = (
  episodePath: string,
  token: string
): string =>
  token
    ? `${episodePath}?${COMMENT_TOKEN_PARAM}=${encodeURIComponent(token)}`
    : episodePath;
