"use client";

import { Button } from "@publira/ui-components/button";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { toDateTimeLocalValue } from "@publira/utils";
import { useActionState, useCallback } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import { PublishAtInput } from "../../_components/publish-at-input";
import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeScheduleFormProps {
  seriesPublicId: string;
  episodePublicId: string;
  scheduledAt?: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  timeZone: string;
}

export const EpisodeScheduleForm = ({
  seriesPublicId,
  episodePublicId,
  scheduledAt = "",
  action,
  timeZone,
}: EpisodeScheduleFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "publish_at",
        localName: "publish_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.series.episodes.schedule_title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.series.episodes.schedule_description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4" onSubmit={handleSubmit}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <Fieldset disabled={isPending}>
          <PublishAtInput
            defaultValue={toDateTimeLocalValue(scheduledAt, timeZone)}
            name="publish_at"
            timeZone={timeZone}
          />
        </Fieldset>

        {state && state.mode === "schedule" ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={isPending} type="submit">
            {isPending
              ? t("admin.series.episodes.updating")
              : t("admin.series.episodes.schedule_update")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
