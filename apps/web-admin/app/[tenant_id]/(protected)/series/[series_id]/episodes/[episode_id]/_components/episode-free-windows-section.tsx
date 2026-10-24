import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import type { EpisodeFreeWindowItem } from "#lib/episode-free-window";
import { scheduledPeriodStatus } from "#lib/scheduled-period";
import type { ScheduledPeriodStatus } from "#lib/scheduled-period";

import type { EpisodeEditActionState } from "../episode-edit-types";
import { ScheduledPeriodDeleteButton } from "./scheduled-period-delete-button";

interface EpisodeFreeWindowsSectionProps {
  createAction: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  deleteAction: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  episodePublicId: string;
  freeWindows: readonly EpisodeFreeWindowItem[];
  locale: Locale;
  /** The moment each window's standing is read against. */
  now: Temporal.Instant;
  seriesPublicId: string;
  tenantId: string;
  timeZone: string;
}

const FreeWindowStatus = ({ status }: { status: ScheduledPeriodStatus }) => {
  switch (status) {
    case "open": {
      return (
        <StatusChip status="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.free_windows.status_open" />
          </Suspense>
        </StatusChip>
      );
    }
    case "scheduled": {
      return (
        <StatusChip status="info">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.free_windows.status_scheduled" />
          </Suspense>
        </StatusChip>
      );
    }
    default: {
      return (
        <StatusChip>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.series.episodes.free_windows.status_ended" />
          </Suspense>
        </StatusChip>
      );
    }
  }
};

/**
 * The periods during which this episode reads as free, each removable, and a
 * form that schedules another. The list keeps the API's order: the window
 * furthest ahead first, then the open one, then the ones already over.
 */
export const EpisodeFreeWindowsSection = ({
  createAction,
  deleteAction,
  episodeId,
  episodePublicId,
  freeWindows,
  locale,
  now,
  seriesPublicId,
  tenantId,
  timeZone,
}: EpisodeFreeWindowsSectionProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.series.episodes.free_windows.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.series.episodes.free_windows.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>

    {freeWindows.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="admin.series.episodes.free_windows.empty" />
        </Suspense>
      </p>
    ) : (
      <ul className="grid divide-y divide-border border border-border">
        {freeWindows.map((window) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            key={window.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <Message
                    message="admin.series.episodes.free_windows.period"
                    values={{
                      ends_at: formatDateTime(window.endsAt, {
                        locale,
                        timeZone,
                      }),
                      starts_at: formatDateTime(window.startsAt, {
                        locale,
                        timeZone,
                      }),
                    }}
                  />
                </Suspense>
              </span>
              <FreeWindowStatus status={scheduledPeriodStatus(window, now)} />
            </div>
            <ScheduledPeriodDeleteButton
              action={deleteAction}
              fieldName="free_window_id"
              messages={{
                confirmAction:
                  "admin.series.episodes.free_windows.delete_confirm_action",
                confirmDescription:
                  "admin.series.episodes.free_windows.delete_confirm_description",
                confirmTitle:
                  "admin.series.episodes.free_windows.delete_confirm_title",
                delete: "admin.series.episodes.free_windows.delete",
                deleting: "admin.series.episodes.free_windows.deleting",
              }}
              periodId={window.id}
              tenantId={tenantId}
            />
          </li>
        ))}
      </ul>
    )}

    <ActionForm.Root action={createAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionForm.Fieldset className="grid gap-4 sm:grid-cols-2">
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.free_windows.starts_at" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <InstantInput name="starts_at" step={60} timeZone={timeZone} />
          </Field.Content>
        </Field.Root>
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.free_windows.ends_at" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <InstantInput name="ends_at" step={60} timeZone={timeZone} />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message
                  message="admin.series.episodes.free_windows.time_zone_description"
                  values={{ time_zone: timeZone }}
                />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.episodes.free_windows.add" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.episodes.free_windows.adding" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
