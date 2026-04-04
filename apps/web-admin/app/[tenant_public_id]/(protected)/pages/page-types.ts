import type { PageItem, PageVersionItem } from "#lib/page";

export type PageMutationMode = "create" | "update" | "draft";

export const formatPageDateTime = (value: string): string => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
    year: "numeric",
  });

  return formatter.format(date);
};

export const normalizePageSlugInput = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "/") {
    return "";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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
