"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import type { EpisodeActionState } from "../episode-types";
import { PublishAtInput } from "./publish-at-input";

interface EpisodeFormProps {
  seriesPublicId: string;
  action: (
    prevState: EpisodeActionState,
    formData: FormData
  ) => Promise<EpisodeActionState>;
  timeZone: string;
}

export const EpisodeForm = ({
  seriesPublicId,
  action,
  timeZone,
}: EpisodeFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
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

  let submitLabel = getMessage(messages, "admin.series.episodes.form.create");
  if (isPending) {
    submitLabel = getMessage(messages, "admin.series.episodes.form.submitting");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.series.episodes.form.card_title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.series.episodes.form.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          className="grid gap-4"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.series.episodes.form.title")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="title"
                placeholder={getMessage(
                  messages,
                  "admin.series.episodes.form.title_placeholder"
                )}
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.series.episodes.form.price")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={0}
                min={0}
                name="price"
                required
                type="number"
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.series.episodes.form.price_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>
              {getMessage(
                messages,
                "admin.series.episodes.form.reading_period"
              )}
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
                {getMessage(
                  messages,
                  "admin.series.episodes.form.reading_period_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <PublishAtInput timeZone={timeZone} />

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
      </CardContent>
    </Card>
  );
};
