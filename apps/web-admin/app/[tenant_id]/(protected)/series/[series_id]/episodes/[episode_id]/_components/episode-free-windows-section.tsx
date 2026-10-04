import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import type { EpisodeFreeWindowItem } from "#lib/episode-free-window";
import { episodeFreeWindowStatus } from "#lib/free-window-period";
import type { EpisodeFreeWindowStatus } from "#lib/free-window-period";

import type { EpisodeEditActionState } from "../episode-edit-types";
import { FreeWindowDeleteButton } from "./free-window-delete-button";

interface EpisodeFreeWindowsSectionProps {
  createAction: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  deleteAction: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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

const FreeWindowStatus = ({ status }: { status: EpisodeFreeWindowStatus }) => {
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
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.series.episodes.free_windows.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.series.episodes.free_windows.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>

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
              <FreeWindowStatus status={episodeFreeWindowStatus(window, now)} />
            </div>
            <FreeWindowDeleteButton
              action={deleteAction}
              freeWindowId={window.id}
              tenantId={tenantId}
            />
          </li>
        ))}
      </ul>
    )}

    <ActionForm action={createAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />

      <ActionFormFieldset className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.free_windows.starts_at" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <InstantInput name="starts_at" step={60} timeZone={timeZone} />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.free_windows.ends_at" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <InstantInput name="ends_at" step={60} timeZone={timeZone} />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message
                  message="admin.series.episodes.free_windows.time_zone_description"
                  values={{ time_zone: timeZone }}
                />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.series.episodes.free_windows.add" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.episodes.free_windows.adding" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
