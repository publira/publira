import { formatDateTime } from "@publira/utils";

import type { PageItem, PageVersionItem } from "#lib/page";

export type PageMutationMode = "create" | "update" | "draft";

/**
 * Page timestamps used to be formatted in UTC while every other admin screen
 * used the display zone; they now go through the shared {@link formatDateTime}.
 * Unparseable values still fall through as-is so a malformed API response stays
 * visible instead of turning into a placeholder.
 */
export const formatPageDateTime = (value: string): string =>
  value ? formatDateTime(value) : "-";

/**
 * Canonical page slug for create/update forms and display.
 * Collapses leading/trailing/repeated `/` so `/privacy` and `//privacy/`
 * both become `/privacy`. Multi-segment paths become `/a/b`.
 */
export const normalizePageSlugInput = (value: string): string => {
  let normalized = value.trim();

  if (!normalized || normalized === "/") {
    return "";
  }

  while (normalized.includes("//")) {
    normalized = normalized.replaceAll("//", "/");
  }
  normalized = normalized.replaceAll(/^\/+|\/+$/gu, "");
  if (!normalized) {
    return "";
  }

  return `/${normalized}`;
};

export const formatPagePath = (slug: string): string => {
  const normalized = normalizePageSlugInput(slug);
  return normalized || "/";
};

export type PageFormState = {
  ok: false;
  message: string;
  mode: PageMutationMode;
} | null;

export type PageListItem = PageItem;
export type PageVersionListItem = PageVersionItem;
