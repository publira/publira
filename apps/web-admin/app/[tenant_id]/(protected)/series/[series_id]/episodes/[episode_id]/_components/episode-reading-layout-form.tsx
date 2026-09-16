"use client";

import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useActionState, useCallback, useId, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
import {
  isReadingDirectionValue,
  spreadStartPageOf,
} from "#lib/reading-layout";
import type {
  EpisodeReadingLayoutOverrides,
  ReadingDirectionValue,
  ReadingLayout,
} from "#lib/reading-layout";
import { useTenantId } from "#lib/use-tenant-id";

import type { EpisodeEditActionState } from "../episode-edit-types";

type SpreadStartSource = "episode" | "series";

const isSpreadStartSource = (value: string): value is SpreadStartSource =>
  value === "episode" || value === "series";

/**
 * The option that leaves the direction following the series, naming the one
 * the series is read in. Its own component because that name is one catalog
 * string written into another.
 */
const SeriesDirectionOptionLabel = ({
  direction,
}: {
  direction: ReadingDirectionValue;
}) => {
  const t = useAdminMessages();

  return t("admin.series.episodes.layout.follow_series_direction", {
    direction:
      direction === "ltr"
        ? t("admin.series.form.reading_direction_options.ltr")
        : t("admin.series.form.reading_direction_options.rtl"),
  });
};

interface EpisodeReadingLayoutFormProps {
  seriesPublicId: string;
  episodePublicId: string;
  /**
   * What the episode states of its own. Seeded once per mount: the page keys
   * this form by these values, so a saved change remounts it.
   */
  initialLayout: EpisodeReadingLayoutOverrides;
  /**
   * What the series states, for the options that follow it. Absent when that
   * read failed, and the options then say only that they follow the series — a
   * wrong value named there would be read as the series' own.
   */
  seriesLayout?: ReadingLayout;
  /**
   * How many pages the episode has, which bounds the page spreads can start
   * at. Absent when the page list failed to load, and the server is then what
   * refuses a page past the last one.
   */
  pageCount?: number;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
}

export const EpisodeReadingLayoutForm = ({
  seriesPublicId,
  episodePublicId,
  initialLayout,
  seriesLayout,
  pageCount,
  action,
}: EpisodeReadingLayoutFormProps) => {
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [readingDirection, setReadingDirection] = useState(
    () => initialLayout.readingDirection
  );
  const [spreadStartSource, setSpreadStartSource] = useState<SpreadStartSource>(
    () => (initialLayout.spreadStartIndex === undefined ? "series" : "episode")
  );
  // `Select` renders a trigger rather than a Field control, so each label
  // needs an id to point at.
  const directionSelectId = useId();
  const spreadStartSelectId = useId();

  const handleDirectionChange = useCallback((next: string) => {
    if (next === "" || isReadingDirectionValue(next)) {
      setReadingDirection(next);
    }
  }, []);

  const handleSpreadStartSourceChange = useCallback((next: string) => {
    if (isSpreadStartSource(next)) {
      setSpreadStartSource(next);
    }
  }, []);

  const hasNoPages = pageCount === 0;
  const seriesSpreadStartPage =
    seriesLayout === undefined
      ? undefined
      : spreadStartPageOf(seriesLayout.spreadStartIndex);
  let defaultSpreadStartPage = 1;
  if (initialLayout.spreadStartIndex !== undefined) {
    defaultSpreadStartPage = spreadStartPageOf(initialLayout.spreadStartIndex);
  } else if (
    seriesSpreadStartPage !== undefined &&
    (pageCount === undefined || seriesSpreadStartPage <= pageCount)
  ) {
    defaultSpreadStartPage = seriesSpreadStartPage;
  }

  const directionItems = [
    {
      label: (
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          {seriesLayout === undefined ? (
            <ClientMessage message="admin.series.episodes.layout.follow_series" />
          ) : (
            <SeriesDirectionOptionLabel
              direction={seriesLayout.readingDirection}
            />
          )}
        </Suspense>
      ),
      value: "",
    },
    {
      label: (
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ClientMessage message="admin.series.form.reading_direction_options.rtl" />
        </Suspense>
      ),
      value: "rtl",
    },
    {
      label: (
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ClientMessage message="admin.series.form.reading_direction_options.ltr" />
        </Suspense>
      ),
      value: "ltr",
    },
  ];

  const spreadStartItems = [
    {
      label: (
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          {seriesSpreadStartPage === undefined ? (
            <ClientMessage message="admin.series.episodes.layout.follow_series" />
          ) : (
            <ClientMessage
              message="admin.series.episodes.layout.follow_series_spread_start"
              values={{ page: String(seriesSpreadStartPage) }}
            />
          )}
        </Suspense>
      ),
      value: "series",
    },
    // An episode with no pages has none to name, so following is its only
    // choice until pages are added.
    ...(hasNoPages
      ? []
      : [
          {
            label: (
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <ClientMessage message="admin.series.episodes.layout.spread_start_override" />
              </Suspense>
            ),
            value: "episode",
          },
        ]),
  ];

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.episodes.layout.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <ClientMessage message="admin.series.episodes.layout.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <Field>
          <FieldLabel htmlFor={directionSelectId}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.episodes.layout.reading_direction" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Select
              id={directionSelectId}
              items={directionItems}
              onValueChange={handleDirectionChange}
              value={readingDirection}
            />
            <input
              name="reading_direction"
              type="hidden"
              value={readingDirection}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor={spreadStartSelectId}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.series.episodes.layout.spread_start" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Select
              id={spreadStartSelectId}
              items={spreadStartItems}
              onValueChange={handleSpreadStartSourceChange}
              value={spreadStartSource}
            />
            <input
              name="spread_start_source"
              type="hidden"
              value={spreadStartSource}
            />
            {hasNoPages ? (
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <ClientMessage message="admin.series.episodes.layout.spread_start_no_pages" />
                </Suspense>
              </FieldDescription>
            ) : null}
          </FieldContent>
        </Field>

        {spreadStartSource === "episode" ? (
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <ClientMessage message="admin.series.episodes.layout.spread_start_page" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={defaultSpreadStartPage}
                max={pageCount}
                min={1}
                name="spread_start_page"
                required
                step={1}
                type="number"
              />
              {pageCount === undefined ? null : (
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                    <ClientMessage
                      message="admin.series.episodes.layout.spread_start_page_description"
                      values={{ count: String(pageCount) }}
                    />
                  </Suspense>
                </FieldDescription>
              )}
            </FieldContent>
          </Field>
        ) : null}

        {state && state.mode === "layout" ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={isPending} type="submit">
            {isPending
              ? t("admin.series.episodes.updating")
              : t("admin.series.episodes.layout.update")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
