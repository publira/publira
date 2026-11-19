import type { Locale } from "@publira/i18n";
import { formatDateTime } from "@publira/utils";

import type {
  PageDeletionReference,
  PageItem,
  PageVersionItem,
} from "#lib/page";
import { translationEditPath } from "#lib/translation-locales";

/**
 * Page timestamps used to be formatted in UTC while every other admin screen
 * used the display zone; they now go through the shared {@link formatDateTime}
 * in the tenant's zone. Unparseable values still fall through as-is so a
 * malformed API response stays visible instead of turning into a placeholder.
 */
export const formatPageDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "-");

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

  normalized = normalized.replaceAll(/^\/|\/$/gu, "");

  if (!normalized) {
    return "";
  }

  return `/${normalized}`;
};

export const formatPagePath = (slug: string): string => {
  const normalized = normalizePageSlugInput(slug);

  return normalized || "/";
};

/**
 * The edit screen of one translation of a page, with the flag its toast reads.
 * Without a locale it opens the translation the tenant's default locale
 * resolves to.
 */
export const pageEditPath = (
  pageId: string,
  translationLocale: Locale | undefined,
  flash?: string
): string => translationEditPath(`/pages/${pageId}`, translationLocale, flash);

/** `fieldErrors.slug` puts the reason beside the slug input. */
export type PageFormState = {
  fieldErrors?: { slug?: string };
  ok: false;
  message: string;
} | null;

export type PageListItem = PageItem;

export type PageVersionListItem = PageVersionItem;

/**
 * A deletion the API refused, with where to clear what holds the page when the
 * console can point to it. A deletion that goes through leaves the screen
 * instead of answering.
 */
export type PageDeleteActionState = {
  ok: false;
  message: string;
  link?: { href: string; reference: PageDeletionReference };
} | null;

/**
 * Whether the slug typed into the delete dialog is the page's, compared as the
 * path it serves: with or without its leading `/`, and `/` for the page at the
 * site's root. Nothing typed confirms nothing.
 */
export const isPageSlugConfirmed = (typed: string, slug: string): boolean =>
  typed.trim() !== "" && formatPagePath(typed) === formatPagePath(slug);
