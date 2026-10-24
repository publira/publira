import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { spreadStartPageOf } from "#lib/reading-layout";
import type {
  EpisodeReadingLayoutOverrides,
  ReadingLayout,
} from "#lib/reading-layout";

import { EpisodeReadingDirectionSelect } from "./episode-reading-direction-select";
import * as SpreadStart from "./episode-reading-layout-controls";

interface EpisodeReadingLayoutFormProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
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
  episodeId,
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
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.layout.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.series.episodes.layout.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root action={action} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_id" type="hidden" value={episodeId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <ActionForm.Fieldset className="grid gap-4">
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.layout.reading_direction" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <EpisodeReadingDirectionSelect
                initialValue={initialLayout.readingDirection}
                seriesDirection={seriesLayout?.readingDirection}
              />
            </Field.Content>
          </Field.Root>

          <SpreadStart.Root
            initialValue={
              initialLayout.spreadStartIndex === undefined
                ? "series"
                : "episode"
            }
          >
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.series.episodes.layout.spread_start" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <SpreadStart.SourceSelect
                  hasNoPages={hasNoPages}
                  seriesSpreadStartPage={seriesSpreadStartPage}
                />
                {hasNoPages ? (
                  <Field.Description>
                    <Suspense
                      fallback={<SkeletonLine className="h-4 w-full" />}
                    >
                      <Message message="admin.series.episodes.layout.spread_start_no_pages" />
                    </Suspense>
                  </Field.Description>
                ) : null}
              </Field.Content>
            </Field.Root>
            <SpreadStart.PageField>
              <Field.Root>
                <Field.Label required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                    <Message message="admin.series.episodes.layout.spread_start_page" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
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
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-full" />}
                      >
                        <Message
                          message="admin.series.episodes.layout.spread_start_page_description"
                          values={{ count: String(pageCount) }}
                        />
                      </Suspense>
                    </Field.Description>
                  )}
                </Field.Content>
              </Field.Root>
            </SpreadStart.PageField>
          </SpreadStart.Root>
        </ActionForm.Fieldset>

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.layout.update" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.updating" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
