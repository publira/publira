"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useCallback, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import type { CreateAnnouncementActionState } from "../announcement-types";

interface AnnouncementFormProps {
  /** The tenant's display zone, which the banner's stop time is written in. */
  timeZone: string;
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
}

export const AnnouncementForm = ({
  timeZone,
  action,
}: AnnouncementFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [pinned, setPinned] = useState(false);

  const handlePinnedChange = useCallback((checked: boolean) => {
    setPinned(checked);
  }, []);

  // The stop time is typed as a wall clock and stored as an instant. The
  // conversion happens against the zone the field was rendered in, so a browser
  // somewhere else does not shift the hour the operator wrote.
  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "pinned_until",
        localName: "pinned_until_local",
        timeZone,
      });
    },
    [timeZone]
  );

  return (
    <form action={formAction} className="grid gap-5" onSubmit={handleSubmit}>
      <input name="tenant_id" type="hidden" value={tenantId} />

      <Fieldset className="grid gap-5" disabled={isPending}>
        <Field>
          <FieldLabel required>
            <ClientMessage message="admin.announcements.form.title" />
          </FieldLabel>
          <FieldContent>
            <Input
              maxLength={120}
              name="title"
              placeholder={t("admin.announcements.form.title_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <ClientMessage message="admin.announcements.form.body" />
          </FieldLabel>
          <FieldContent>
            <Textarea
              maxLength={2000}
              name="body"
              placeholder={t("admin.announcements.form.body_placeholder")}
              required
              rows={5}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.announcements.form.link" />
          </FieldLabel>
          <FieldContent>
            <Input
              name="link_url"
              placeholder={t("admin.announcements.form.link_placeholder")}
              type="text"
            />
            <FieldDescription>
              <ClientMessage message="admin.announcements.form.link_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.announcements.form.pinned" />
          </FieldLabel>
          <FieldContent>
            <Checkbox
              checked={pinned}
              name="pinned"
              onCheckedChange={handlePinnedChange}
              value="on"
            />
            <FieldDescription>
              <ClientMessage message="admin.announcements.form.pinned_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        {pinned ? (
          <Field>
            <FieldLabel>
              <ClientMessage message="admin.announcements.form.pinned_until" />
            </FieldLabel>
            <FieldContent>
              <input defaultValue="" name="pinned_until" type="hidden" />
              <Input
                name="pinned_until_local"
                step={60}
                type="datetime-local"
              />
              <FieldDescription>
                <ClientMessage
                  message="admin.announcements.form.pinned_until_description"
                  values={{ time_zone: timeZone }}
                />
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}
      </Fieldset>

      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} type="submit">
          <ActionFormIdle>
            <ClientMessage message="admin.announcements.form.submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.announcements.form.submitting" />
          </ActionFormPending>
        </Button>
      </div>
    </form>
  );
};
