import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import type { FormActionState } from "#components/action-form";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { spreadStartPageOf } from "#lib/reading-layout";
import type {
  EpisodeReadingLayoutOverrides,
  ReadingLayout,
} from "#lib/reading-layout";

import {
  ReadingDirectionField,
  SpreadStartSourceField,
} from "./episode-reading-layout-controls";

interface EpisodeReadingLayoutFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  episodePublicId: string;
  /**
   * What the episode states of its own. Seeded once per mount: the page keys
   * this form by these values, so a saved change remounts it.
   */
  initialLayout: EpisodeReadingLayoutOverrides;
  /**
   * How many pages the episode has, which bounds the page spreads can start
   * at. Absent when the page list failed to load, and the server is then what
   * refuses a page past the last one.
   */
  pageCount?: number;
  /**
   * What the series states, for the options that follow it. Absent when that
   * read failed, and the options then say only that they follow the series.
   */
  seriesLayout?: ReadingLayout;
  seriesPublicId: string;
  tenantId: string;
}

export const EpisodeReadingLayoutForm = ({
  action,
  episodePublicId,
  initialLayout,
  pageCount,
  seriesLayout,
  seriesPublicId,
  tenantId,
}: EpisodeReadingLayoutFormProps) => {
  const seriesSpreadStartPage =
    seriesLayout === undefined
      ? undefined
      : spreadStartPageOf(seriesLayout.spreadStartIndex);
  const hasNoPages = pageCount === 0;

  let defaultSpreadStartPage = 1;
  if (initialLayout.spreadStartIndex !== undefined) {
    defaultSpreadStartPage = spreadStartPageOf(initialLayout.spreadStartIndex);
  } else if (
    seriesSpreadStartPage !== undefined &&
    (pageCount === undefined || seriesSpreadStartPage <= pageCount)
  ) {
    defaultSpreadStartPage = seriesSpreadStartPage;
  }

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.layout.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.series.episodes.layout.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm action={action} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <ReadingDirectionField
          initialValue={initialLayout.readingDirection}
          label={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.layout.reading_direction" />
            </Suspense>
          }
          seriesDirection={seriesLayout?.readingDirection}
        />

        <SpreadStartSourceField
          description={
            hasNoPages ? (
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <Message message="admin.series.episodes.layout.spread_start_no_pages" />
                </Suspense>
              </FieldDescription>
            ) : null
          }
          hasNoPages={hasNoPages}
          initialValue={
            initialLayout.spreadStartIndex === undefined ? "series" : "episode"
          }
          label={
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.layout.spread_start" />
            </Suspense>
          }
          pageField={
            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.series.episodes.layout.spread_start_page" />
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
                    <Suspense
                      fallback={<SkeletonLine className="h-4 w-full" />}
                    >
                      <Message
                        message="admin.series.episodes.layout.spread_start_page_description"
                        values={{ count: String(pageCount) }}
                      />
                    </Suspense>
                  </FieldDescription>
                )}
              </FieldContent>
            </Field>
          }
          seriesSpreadStartPage={seriesSpreadStartPage}
        />

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.layout.update" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.updating" />
              </Suspense>
            </ActionFormPending>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
