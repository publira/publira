import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

export const defaultReadingHistoryPageSize = 20;

interface ParseMySearchParamsInput {
  token?: string | string[] | undefined;
}

export interface MySearchParams {
  token: string;
}

/**
 * `/my` shows one paginated list, the reading history, so the bare `token` is
 * unambiguous and reads the same way it does on `/my/library`.
 */
const mySearchParamsSchema = z.object({ token: cursorTokenSchema });

export const parseMySearchParams = (
  input: ParseMySearchParamsInput
): MySearchParams => mySearchParamsSchema.parse(input);

/**
 * `/my` at the history page the token names, which is both where the pager
 * links and where a reader sent to sign in has to come back to. Dropping the
 * token there would land them on page 1 of a history they were paging through.
 */
export const myPageHref = (token: string): string =>
  cursorPageHref("/my", token);

/** What `/my` hands its sections so each can resolve the page it is on. */
export type MyPageSearchParams =
  PageProps<"/[tenant_id]/[locale]/my">["searchParams"];

/**
 * The history page the request names, resolved inside the section that needs
 * it. `/my` has no component above its `<Suspense>` boundaries that could
 * resolve it once: reading the search params up there would cost the page its
 * static shell, so each section awaits them behind its own boundary.
 */
export const resolveMyPageToken = async (
  searchParams: MyPageSearchParams
): Promise<string> => {
  const resolved = await searchParams;
  return parseMySearchParams(resolved).token;
};
