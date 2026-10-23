"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Switch } from "@publira/ui-components/switch";
import { useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { TenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";
import {
  isEmailRejectionEntry,
  MAX_EMAIL_REJECTION_ENTRIES,
  parseEmailRejectionEntries,
} from "#lib/tenant-email-rejection-settings-shared";

import type { TenantEmailRejectionActionState } from "../settings-types";
import {
  EntryList,
  EntryListAdd,
  EntryListDescription,
  EntryListField,
  EntryListInput,
  EntryListLegend,
  EntryListMessage,
  EntryListRemove,
  EntryListRows,
  useEntryListRow,
  useEntryListValues,
} from "./entry-list";

type SettledState = NonNullable<TenantEmailRejectionActionState>;

/** One address or domain, named once the operator has left its field. */
const EmailRejectionEntry = () => {
  const t = useClientMessages();
  const { position, touched, value } = useEntryListRow();
  const entry = value.trim();
  const invalid = touched && entry !== "" && !isEmailRejectionEntry(entry);

  return (
    <>
      <EntryListField invalid={invalid}>
        <EntryListInput
          aria-label={t("admin.settings.email_rejection.entry_label", {
            position,
          })}
          name="entries"
        />
        {invalid ? (
          <FormMessage variant="destructive">
            <ClientMessage
              message="admin.settings.email_rejection.validation.entry_invalid"
              values={{ entry }}
            />
          </FormMessage>
        ) : null}
      </EntryListField>
      <EntryListRemove
        aria-label={t("admin.settings.email_rejection.entry_remove", {
          position,
        })}
      />
    </>
  );
};

/** A list longer than the server keeps, or the server's refusal of it. */
const EmailRejectionEntriesMessage = () => {
  const t = useClientMessages();
  const state = ActionForm.useState<SettledState>();
  const list = parseEmailRejectionEntries(useEntryListValues());

  if (!list.ok && list.reason === "too_many") {
    return (
      <EntryListMessage>
        {t("admin.settings.email_rejection.validation.too_many", {
          max: MAX_EMAIL_REJECTION_ENTRIES,
        })}
      </EntryListMessage>
    );
  }
  return (
    <EntryListMessage>
      {state?.ok === false ? state.fieldErrors?.entries : undefined}
    </EntryListMessage>
  );
};

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
 * The switch and the list, one address or domain per field. Each field is
 * checked once the operator leaves it, with the rule the server applies, so an
 * entry it would refuse is named before the round trip. A paste of several
 * lines into one field becomes one field per line. A save answers the list as
 * the server stored it, which is what the fields then hold.
 */
export const TenantEmailRejectionFields = ({
  disposableDomainListAvailable,
  initialSettings,
}: TenantEmailRejectionFieldsProps) => {
  const [rejectDisposableDomains, setRejectDisposableDomains] = useState(
    () => initialSettings?.rejectDisposableDomains ?? false
  );
  const [entries, setEntries] = useState(() => initialSettings?.entries ?? []);
  // Bumped by each save, which remounts the list on what the server stored.
  const [savedCount, setSavedCount] = useState(0);
  const [listAvailable, setListAvailable] = useState(
    () => disposableDomainListAvailable
  );

  ActionForm.useSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }
    setRejectDisposableDomains(settled.settings.rejectDisposableDomains);
    setEntries(settled.settings.entries);
    setSavedCount((count) => count + 1);
    setListAvailable(settled.disposableDomainListAvailable);
  });

  return (
    <>
      <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-3">
        <Switch
          checked={rejectDisposableDomains}
          className="row-span-2 mt-0.5"
          name="reject_disposable_domains"
          onCheckedChange={setRejectDisposableDomains}
        />
        <Field.Label>
          <ClientMessage message="admin.settings.email_rejection.disposable_label" />
        </Field.Label>
        <Field.Description className="col-start-2">
          <ClientMessage message="admin.settings.email_rejection.disposable_description" />
        </Field.Description>
      </Field.Root>

      {listAvailable === false ? (
        <FormMessage variant="warning">
          <ClientMessage message="admin.settings.email_rejection.disposable_unavailable" />
        </FormMessage>
      ) : null}

      <EntryList initialEntries={entries} key={savedCount}>
        <EntryListLegend>
          <ClientMessage message="admin.settings.email_rejection.entries_label" />
        </EntryListLegend>
        <EntryListRows>
          <EmailRejectionEntry />
        </EntryListRows>
        <EntryListAdd>
          <ClientMessage message="admin.settings.email_rejection.entries_add" />
        </EntryListAdd>
        <EntryListDescription>
          <ClientMessage message="admin.settings.email_rejection.entries_description" />
        </EntryListDescription>
        <EmailRejectionEntriesMessage />
      </EntryList>
    </>
  );
};
