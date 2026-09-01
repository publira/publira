"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { CollectionIcon } from "@publira/icons";
import { buttonVariants } from "@publira/ui-components/button";
import { cn } from "@publira/utils";
import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { useContext } from "react";
import type { CSSProperties } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { AdminMessageKey } from "#lib/locale";

interface ThemePreviewProps {
  theme: TenantThemeColors;
}

/**
 * The chrome the public site actually names, taken from `host.*` rather than
 * restated under `admin.*`: a facsimile that says "Series" where the site says
 * something else is a picture of a site nobody visits. Only the sample content
 * — the site name and the two works — is the preview's own copy, because the
 * site has no fixed wording for it.
 */
const navLabels: AdminMessageKey[] = [
  "host.nav.series",
  "host.nav.authors",
  "host.nav.labels",
];

const sampleWorks: {
  author: AdminMessageKey;
  synopsis: AdminMessageKey;
  title: AdminMessageKey;
}[] = [
  {
    author: "admin.settings.theme.preview.works.first.author",
    synopsis: "admin.settings.theme.preview.works.first.synopsis",
    title: "admin.settings.theme.preview.works.first.title",
  },
  {
    author: "admin.settings.theme.preview.works.second.author",
    synopsis: "admin.settings.theme.preview.works.second.synopsis",
    title: "admin.settings.theme.preview.works.second.title",
  },
];

const statusChips: { className: string; label: AdminMessageKey }[] = [
  {
    className: "bg-success text-success-foreground",
    label: "admin.settings.theme.preview.status.success",
  },
  {
    className: "bg-warning text-warning-foreground",
    label: "admin.settings.theme.preview.status.warning",
  },
  {
    className: "bg-destructive text-destructive-foreground",
    label: "admin.settings.theme.preview.status.destructive",
  },
  {
    className: "bg-info text-info-foreground",
    label: "admin.settings.theme.preview.status.info",
  },
];

/**
 * A header, a catalog, and a footer painted from the colors currently in the
 * form, so a combination can be judged where it will be read instead of as
 * swatches side by side.
 *
 * The frame carries the theme itself rather than reading the console's own
 * tokens: `/theme.css` is a separate request with its own short cache, so
 * right after another operator saves, the document can still be painted in the
 * previous colors while the form already holds the current ones. Only what
 * `theme` says is on screen here.
 *
 * Nothing inside is interactive or reaches the accessibility tree — it is
 * sample content standing in for a site, and a screen reader announcing a
 * catalog that does not exist would be reading a lie.
 */
export const ThemePreview = ({ theme }: ThemePreviewProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const siteName = getMessage(
    messages,
    "admin.settings.theme.preview.site_name"
  );
  // `CSSProperties` has no index signature, which is what React's own types
  // say to assert past when the value is a set of custom properties.
  const themeVariables = toPubliraThemeCssVariables(theme) as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="publira-theme-scope pointer-events-none overflow-hidden rounded-xl border border-border bg-background text-foreground"
      style={themeVariables}
    >
      <div className="flex flex-wrap items-center gap-3 border-t-2 border-b border-border/70 border-t-secondary bg-card/70 px-4 py-3">
        <span className="font-serif text-base font-semibold">{siteName}</span>
        <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
          {navLabels.map((label) => (
            <span key={label}>{getMessage(messages, label)}</span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-muted-foreground ring-2 ring-ring/40">
            {getMessage(messages, "host.nav.search")}
          </span>
          <span
            className={buttonVariants({ size: "sm", variant: "secondary" })}
          >
            {getMessage(messages, "host.nav.login")}
          </span>
          <span className={buttonVariants({ size: "sm" })}>
            {getMessage(messages, "host.nav.signup")}
          </span>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-5">
        <div className="grid gap-1">
          <p className="font-serif text-lg font-semibold">
            {getMessage(messages, "host.top.recommended_heading")}
          </p>
          <p className="text-xs text-muted-foreground">
            {getMessage(messages, "host.top.description")}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {sampleWorks.map((work) => (
            <div
              className="overflow-hidden rounded-lg border border-border/70 bg-card text-card-foreground shadow-sm"
              key={work.title}
            >
              <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
                <CollectionIcon className="h-8 w-8" />
              </div>
              <div className="grid gap-2 p-4">
                <p className="font-serif text-base font-semibold">
                  {getMessage(messages, work.title)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {getMessage(messages, work.author)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {getMessage(messages, work.synopsis)}
                </p>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    {getMessage(messages, "host.common.free")}
                  </span>
                  <span className={buttonVariants({ size: "sm" })}>
                    {getMessage(messages, "host.common.view_series_detail")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {statusChips.map((chip) => (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                chip.className
              )}
              key={chip.label}
            >
              {getMessage(messages, chip.label)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-2 border-t border-border/70 bg-surface px-4 py-4 text-xs text-surface-foreground">
        <div className="flex flex-wrap gap-4 text-muted-foreground">
          {navLabels.map((label) => (
            <span key={label}>{getMessage(messages, label)}</span>
          ))}
        </div>
        <p>{siteName}</p>
      </div>
    </div>
  );
};
