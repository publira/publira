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
import { useActionState, useCallback } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";
import { useTenantId } from "#lib/use-tenant-id";

import type { EpisodeActionState } from "../episode-types";
import { EpisodeAvailabilityField } from "./episode-availability-field";
import { PublishAtInput } from "./publish-at-input";

interface EpisodeFormProps {
  seriesPublicId: string;
  action: (
    prevState: EpisodeActionState,
    formData: FormData
  ) => Promise<EpisodeActionState>;
  /**
   * What the series is shown on, for the option that follows it. Absent when
   * that read failed.
   */
  seriesAvailability?: SurfaceAvailabilityValue;
  timeZone: string;
}

export const EpisodeForm = ({
  seriesPublicId,
  action,
  seriesAvailability,
  timeZone,
}: EpisodeFormProps) => {
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

  let submitLabel = t("admin.series.episodes.form.create");
  if (isPending) {
    submitLabel = t("admin.series.episodes.form.submitting");
  }

  return (
    <form action={formAction} className="grid gap-4" onSubmit={handleSubmit}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.series.episodes.form.title" />
        </FieldLabel>
        <FieldContent>
          <Input
            name="title"
            placeholder={t("admin.series.episodes.form.title_placeholder")}
            required
            type="text"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.series.episodes.form.price" />
        </FieldLabel>
        <FieldContent>
          <Input defaultValue={0} min={0} name="price" required type="number" />
          <FieldDescription>
            <ClientMessage message="admin.series.episodes.form.price_description" />
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.series.episodes.form.reading_period" />
        </FieldLabel>
        <FieldContent>
          <Input
            defaultValue={0}
            min={0}
            name="reading_period_hours"
            required
            type="number"
          />
          <FieldDescription>
            <ClientMessage message="admin.series.episodes.form.reading_period_description" />
          </FieldDescription>
        </FieldContent>
      </Field>

      <PublishAtInput timeZone={timeZone} />

      <EpisodeAvailabilityField
        initialValue=""
        seriesAvailability={seriesAvailability}
      />

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button disabled={isPending} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};
