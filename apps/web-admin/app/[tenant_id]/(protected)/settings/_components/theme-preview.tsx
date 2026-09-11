"use client";

import { Badge } from "@publira/ui-components/badge";
import { buttonVariants } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { Suspense } from "react";
import type { CSSProperties, ReactNode } from "react";

import { ClientMessage } from "#components/client-message";

interface ThemePreviewProps {
  theme: TenantThemeColors;
}

/**
 * The site's own navigation, taken from `host.*` rather than restated under
 * `admin.*`: a facsimile that says "Series" where the site says something else
 * is a picture of a site nobody visits. Only the sample content — the site
 * name and the two works — is the preview's own copy, because the site has no
 * fixed wording for it.
 */
const SiteNavLabels = () => (
  <>
    <span>
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <ClientMessage message="host.nav.series" />
      </Suspense>
    </span>
    <span>
      <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
        <ClientMessage message="host.nav.creators" />
      </Suspense>
    </span>
    <span>
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <ClientMessage message="host.nav.labels" />
      </Suspense>
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
      <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
        <ClientMessage message="host.common.free" />
      </Suspense>
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
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <ClientMessage message="admin.settings.theme.preview.site_name" />
          </Suspense>
        </span>
        <div className="hidden items-center gap-4 text-sm sm:flex">
          <SiteNavLabels />
        </div>
        {/* The three wrap together rather than holding one line: a facsimile
            narrow enough to sit in a settings card still has to fit inside
            it, and each of these carries `white-space: nowrap`. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-control border border-input bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
              <ClientMessage message="host.nav.search" />
            </Suspense>
          </span>
          <span className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ClientMessage message="host.nav.login" />
            </Suspense>
          </span>
          <span className={buttonVariants({ size: "sm", variant: "ink" })}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <ClientMessage message="host.nav.signup" />
            </Suspense>
          </span>
        </div>
      </div>

      <div className="grid gap-6 px-4 py-5">
        <section>
          <div className="flex aspect-16/7 items-center justify-center rounded-surface bg-muted p-3 text-center">
            <span className="font-serif text-lg leading-tight text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <ClientMessage message="admin.settings.theme.preview.works.first.title" />
              </Suspense>
            </span>
          </div>
          <p className="mt-3 font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-6 w-64" />}>
              <ClientMessage message="admin.settings.theme.preview.works.first.title" />
            </Suspense>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.theme.preview.works.first.author" />
            </Suspense>
          </p>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <ClientMessage message="admin.settings.theme.preview.works.first.synopsis" />
              </Suspense>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className={buttonVariants({ size: "sm" })}>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <ClientMessage message="host.common.view_series_detail" />
                </Suspense>
              </span>
              <span
                className={buttonVariants({ size: "sm", variant: "secondary" })}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                  <ClientMessage message="host.common.read" />
                </Suspense>
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
            <p className="font-serif text-base leading-tight">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <ClientMessage message="host.top.free_heading" />
              </Suspense>
            </p>
            <span className="text-xs text-primary underline underline-offset-4">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <ClientMessage message="host.top.view_all" />
              </Suspense>
            </span>
          </div>
          <div className="divide-y divide-border">
            <WorkRow
              author={
                <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
                  <ClientMessage message="admin.settings.theme.preview.works.first.author" />
                </Suspense>
              }
              title={
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <ClientMessage message="admin.settings.theme.preview.works.first.title" />
                </Suspense>
              }
            />
            <WorkRow
              author={
                <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
                  <ClientMessage message="admin.settings.theme.preview.works.second.author" />
                </Suspense>
              }
              title={
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <ClientMessage message="admin.settings.theme.preview.works.second.title" />
                </Suspense>
              }
            />
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <Badge tone="success" variant="solid">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <ClientMessage message="admin.settings.theme.preview.status.success" />
            </Suspense>
          </Badge>
          <Badge tone="warning" variant="solid">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <ClientMessage message="admin.settings.theme.preview.status.warning" />
            </Suspense>
          </Badge>
          <Badge tone="destructive" variant="solid">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ClientMessage message="admin.settings.theme.preview.status.destructive" />
            </Suspense>
          </Badge>
          <Badge tone="info" variant="solid">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <ClientMessage message="admin.settings.theme.preview.status.info" />
            </Suspense>
          </Badge>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border bg-surface px-4 py-4 text-xs text-surface-foreground">
        <div className="flex flex-wrap gap-4 text-muted-foreground">
          <SiteNavLabels />
        </div>
        <p>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ClientMessage message="admin.settings.theme.preview.site_name" />
          </Suspense>
        </p>
      </div>
    </div>
  );
};
