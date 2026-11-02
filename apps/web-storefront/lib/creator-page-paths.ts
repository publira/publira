import { routeParamString } from "@publira/utils/route-params";
import { z } from "zod";

/**
 * An Author's primary key, as `ListMyCreators` names it. Anything else names
 * no Author the reader could be linked to, so the page is not found without
 * asking the API, which would refuse it as `invalid_argument`.
 */
export const creatorIdParamSchema = routeParamString().pipe(z.uuid());

/** A closed month as the API names it, `YYYY-MM`. */
export const periodParamSchema = routeParamString().pipe(
  z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u)
);

/** The page of one Author, with the cursors of its two lists. */
export const creatorPageHref = (
  creatorId: string,
  {
    statementsToken = "",
    token = "",
  }: { statementsToken?: string; token?: string } = {}
): string => {
  const query = new URLSearchParams();

  if (token) {
    query.set("token", token);
  }

  if (statementsToken) {
    query.set("statements", statementsToken);
  }

  const search = query.toString();
  const pathname = `/my/creators/${creatorId}`;

  return search ? `${pathname}?${search}` : pathname;
};

/** One closed month of an Author's statements. */
export const creatorStatementHref = (
  creatorId: string,
  period: string,
  token = ""
): string => {
  const pathname = `/my/creators/${creatorId}/statements/${period}`;

  return token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
};
