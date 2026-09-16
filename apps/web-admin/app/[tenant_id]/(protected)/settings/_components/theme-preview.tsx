"use client";

import { Badge } from "@publira/ui-components/badge";
import { buttonVariants } from "@publira/ui-components/button";
import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type { TenantTheme } from "@publira/utils/theme-css-variables";
import type { CSSProperties, ReactNode } from "react";

import { ClientMessage } from "#components/client-message";

interface ThemePreviewProps {
  theme: TenantTheme;
}

/**
 * The site's own navigation, taken from `host.*` rather than restated under
 * `admin.*`: a facsimile that says "Labels" where the site says something else
 * is a picture of a site nobody visits. The row is the one the site header
 * draws, so it names what that row names and changes with it. Only the sample
 * content — the site name and the two works — is the preview's own copy,
 * because the site has no fixed wording for it.
 */
const SiteNavLabels = () => (
  <>
    <span>
      <ClientMessage message="host.nav.labels" />
    </span>
    <span>
      <ClientMessage message="host.nav.genres" />
    </span>
  </>
);

/**
 * One row of the list a section of the site is, with its artwork missing.
 *
 * Both lines wrap rather than truncate. `white-space: nowrap` would make this
 * row's min-content width the whole title, and nothing between here and the
 * console's page grid clamps that: the grid's one automatic column takes the
 * widest item's min-content as its minimum, so a long sample title carries
 * every card on the settings screen past the edge of a phone.
 */
const WorkRow = ({
  author,
  title,
}: {
  author: ReactNode;
  title: ReactNode;
}) => (
  <div className="flex items-center gap-3 py-3">
    <span className="aspect-16/9 w-20 shrink-0 rounded-control bg-muted" />
    <span className="min-w-0 flex-1">
      <span className="block font-serif text-sm leading-tight">{title}</span>
      <span className="block text-xs text-muted-foreground">{author}</span>
    </span>
    <Badge tone="success">
      <ClientMessage message="host.common.free" />
    </Badge>
  </div>
);

/**
 * A header, a featured work, a list, and a footer painted from the colors
 * currently in the form, so a combination can be judged where it will be read
 * instead of as swatches side by side.
 *
 * The geometry is the site's own: bands a half step above the paper at the top
 * and the bottom, a hairline where a section starts, rows rather than cards,
 * a work whose missing artwork is a flat `muted` rectangle carrying its title,
 * and the reading action in the one Shu a screen is allowed. No surface here
 * is filled with a gradient, because none on the site is.
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
  // `CSSProperties` has no index signature, which is what React's own types
  // say to assert past when the value is a set of custom properties.
  const themeVariables = toPubliraThemeCssVariables(theme) as CSSProperties;

  return (
    <div
      aria-hidden="true"
      className="publira-theme-scope pointer-events-none overflow-hidden rounded-surface border border-border bg-background text-foreground"
      style={themeVariables}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 text-surface-foreground">
        <span className="font-serif text-lg font-medium">
          <ClientMessage message="admin.settings.theme.preview.site_name" />
        </span>
        <div className="hidden items-center gap-4 text-sm sm:flex">
          <SiteNavLabels />
        </div>
        {/* The three wrap together rather than holding one line: a facsimile
            narrow enough to sit in a settings card still has to fit inside
            it, and each of these carries `white-space: nowrap`. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-control border border-input bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <ClientMessage message="host.nav.search" />
          </span>
          <span className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <ClientMessage message="host.nav.login" />
          </span>
          <span className={buttonVariants({ size: "sm", variant: "ink" })}>
            <ClientMessage message="host.nav.signup" />
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-4 py-5">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="font-serif">
            <ClientMessage message="admin.settings.theme.preview.type_sample" />
          </span>
          <span>
            <ClientMessage message="admin.settings.theme.preview.type_sample" />
          </span>
        </div>

        <section>
          <div className="flex aspect-16/7 items-center justify-center rounded-surface bg-muted p-3 text-center">
            <span className="font-serif text-lg leading-tight text-muted-foreground">
              <ClientMessage message="admin.settings.theme.preview.works.first.title" />
            </span>
          </div>
          <p className="mt-3 font-serif text-xl leading-tight">
            <ClientMessage message="admin.settings.theme.preview.works.first.title" />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <ClientMessage message="admin.settings.theme.preview.works.first.author" />
          </p>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              <ClientMessage message="admin.settings.theme.preview.works.first.synopsis" />
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className={buttonVariants({ size: "sm" })}>
                <ClientMessage message="host.common.view_series_detail" />
              </span>
              <span
                className={buttonVariants({ size: "sm", variant: "secondary" })}
              >
                <ClientMessage message="host.common.read" />
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
            <p className="font-serif text-base leading-tight">
              <ClientMessage message="host.top.free_heading" />
            </p>
            <span className="text-xs text-primary underline underline-offset-4">
              <ClientMessage message="host.top.view_all" />
            </span>
          </div>
          <div className="divide-y divide-border">
            <WorkRow
              author={
                <ClientMessage message="admin.settings.theme.preview.works.first.author" />
              }
              title={
                <ClientMessage message="admin.settings.theme.preview.works.first.title" />
              }
            />
            <WorkRow
              author={
                <ClientMessage message="admin.settings.theme.preview.works.second.author" />
              }
              title={
                <ClientMessage message="admin.settings.theme.preview.works.second.title" />
              }
            />
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Badge tone="success" variant="solid">
            <ClientMessage message="admin.settings.theme.preview.status.success" />
          </Badge>
          <Badge tone="warning" variant="solid">
            <ClientMessage message="admin.settings.theme.preview.status.warning" />
          </Badge>
          <Badge tone="destructive" variant="solid">
            <ClientMessage message="admin.settings.theme.preview.status.destructive" />
          </Badge>
          <Badge tone="info" variant="solid">
            <ClientMessage message="admin.settings.theme.preview.status.info" />
          </Badge>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border bg-surface px-4 py-4 text-xs text-surface-foreground">
        <div className="flex flex-wrap gap-4 text-muted-foreground">
          <SiteNavLabels />
        </div>
        <p>
          <ClientMessage message="admin.settings.theme.preview.site_name" />
        </p>
      </div>
    </div>
  );
};
