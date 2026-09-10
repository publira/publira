import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { forEachPageWithToken } from "@publira/api-client/pagination";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { publicApiClient } from "./public-api";

export type ListTagSuggestionsResult =
  | { ok: true; tagNames: string[] }
  | { ok: false; message: string; tagNames: string[] };

/**
 * The tags the tenant's published series already carry, offered on the series
 * form so an editor reuses a tag instead of coining a near-miss of one.
 *
 * There is no admin RPC for this: a tag has no console of its own, it exists
 * because a series carries it, and `ListPublishedTags` is the one list of them.
 * That read needs no session, so it goes through the public API and is cached
 * for everyone rather than per operator — filed under the tag every series save
 * already drops, so a tag coined on one series is offered on the next.
 *
 * A walk that runs out of budget keeps the tags it did read. The control is a
 * free-text input whose suggestions can never be the whole vocabulary anyway —
 * a tag nobody has used yet is typed, not picked — and a name that matches an
 * existing tag's slug resolves to that tag whether or not it was suggested, so
 * a short list costs an editor a keystroke rather than correctness.
 */
export const listTagSuggestions = async (
  tenantId: string,
  locale: Locale
): Promise<ListTagSuggestionsResult> => {
  "use cache";
  cacheTag(`tenant:${tenantId}:series:list`);

  const tagNames: string[] = [];
  try {
    await forEachPageWithToken(
      async (token, limit) => {
        const response = await publicApiClient.catalog.listPublishedTags({
          limit,
          tenant: { tenantId },
          token,
        });
        return {
          items: response.tags ?? [],
          nextToken: response.nextToken ?? "",
        };
      },
      (items) => {
        for (const item of items) {
          const name = item.name?.trim() ?? "";
          if (name.length > 0) {
            tagNames.push(name);
          }
        }
      }
    );

    return { ok: true, tagNames };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the suggestions come back as
    // soon as the public API does.
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        getMessage(sharedCatalog(locale), "admin.series.tags_unavailable"),
        { locale }
      ),
      ok: false,
      tagNames: [],
    };
  }
};
