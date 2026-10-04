"use client";

import {
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Switch } from "@publira/ui-components/switch";
import { Textarea } from "@publira/ui-components/textarea";
import { useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { TenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";
import {
  MAX_EMAIL_REJECTION_ENTRIES,
  parseEmailRejectionEntries,
} from "#lib/tenant-email-rejection-settings-shared";

import type { TenantEmailRejectionActionState } from "../settings-types";

type SettledState = NonNullable<TenantEmailRejectionActionState>;

interface TenantEmailRejectionFieldsProps {
  /**
   * Whether the platform policy names a disposable-domain list, absent when
   * the setting was not read.
   */
  disposableDomainListAvailable?: boolean;
  /** The saved setting, absent when it was not read. */
  initialSettings?: TenantEmailRejectionSettings;
}

/**
 * The switch and the list. The list is checked line by line once the operator
 * leaves it, with the rule the server applies, so a line it would refuse is
 * named before the round trip. A save answers the list as the server stored
 * it, which is what the fields then hold.
 */
export const TenantEmailRejectionFields = ({
  disposableDomainListAvailable,
  initialSettings,
}: TenantEmailRejectionFieldsProps) => {
  const t = useClientMessages();
  const state = useActionFormState<SettledState>();
  const [rejectDisposableDomains, setRejectDisposableDomains] = useState(
    () => initialSettings?.rejectDisposableDomains ?? false
  );
  const [entries, setEntries] = useState(
    () => initialSettings?.entries.join("\n") ?? ""
  );
  const [listAvailable, setListAvailable] = useState(
    () => disposableDomainListAvailable
  );
  const [entriesTouched, setEntriesTouched] = useState(false);

  useActionFormSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }
    setRejectDisposableDomains(settled.settings.rejectDisposableDomains);
    setEntries(settled.settings.entries.join("\n"));
    setListAvailable(settled.disposableDomainListAvailable);
    setEntriesTouched(false);
  });

  const parsed = parseEmailRejectionEntries(entries);
  let entriesError: string | undefined;
  if (entriesTouched && !parsed.ok) {
    entriesError =
      parsed.reason === "too_many"
        ? t("admin.settings.email_rejection.validation.too_many", {
            max: MAX_EMAIL_REJECTION_ENTRIES,
          })
        : t("admin.settings.email_rejection.validation.entry_invalid", {
            entry: parsed.entry,
          });
  } else if (state?.ok === false) {
    entriesError = state.fieldErrors?.entries;
  }

  return (
    <>
      <Field className="grid-cols-[auto_1fr] items-start gap-x-3">
        <Switch
          checked={rejectDisposableDomains}
          className="row-span-2 mt-0.5"
          name="reject_disposable_domains"
          onCheckedChange={setRejectDisposableDomains}
        />
        <FieldLabel>
          <ClientMessage message="admin.settings.email_rejection.disposable_label" />
        </FieldLabel>
        <FieldDescription className="col-start-2">
          <ClientMessage message="admin.settings.email_rejection.disposable_description" />
        </FieldDescription>
      </Field>

      {listAvailable === false ? (
        <FormMessage variant="warning">
          <ClientMessage message="admin.settings.email_rejection.disposable_unavailable" />
        </FormMessage>
      ) : null}

      <Field invalid={entriesError !== undefined}>
        <FieldLabel>
          <ClientMessage message="admin.settings.email_rejection.entries_label" />
        </FieldLabel>
        <FieldContent>
          <Textarea
            autoCapitalize="none"
            className="min-h-40"
            name="entries"
            onBlur={() => {
              setEntriesTouched(true);
            }}
            onChange={(event) => {
              setEntries(event.target.value);
            }}
            spellCheck={false}
            value={entries}
          />
          <FieldDescription>
            <ClientMessage message="admin.settings.email_rejection.entries_description" />
          </FieldDescription>
          {entriesError === undefined ? null : (
            <FormMessage variant="destructive">{entriesError}</FormMessage>
          )}
        </FieldContent>
      </Field>
    </>
  );
};
