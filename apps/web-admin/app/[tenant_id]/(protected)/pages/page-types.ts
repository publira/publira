import type { PageItem, PageVersionItem } from "#lib/page";

export type PageMutationMode = "create" | "update" | "draft";

const pageDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
  year: "numeric",
});

export const formatPageDateTime = (value: string): string => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return pageDateTimeFormatter.format(date);
};

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
