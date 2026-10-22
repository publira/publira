"use client";

import {
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
import { EntryListFields } from "./entry-list-fields";

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
  const t = useClientMessages();
  const state = useActionFormState<SettledState>();
  const [rejectDisposableDomains, setRejectDisposableDomains] = useState(
    () => initialSettings?.rejectDisposableDomains ?? false
  );
  const [entries, setEntries] = useState(() => initialSettings?.entries ?? []);
  // Bumped by each save, which remounts the list on what the server stored.
  const [savedCount, setSavedCount] = useState(0);
  const [listAvailable, setListAvailable] = useState(
    () => disposableDomainListAvailable
  );

  useActionFormSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }
    setRejectDisposableDomains(settled.settings.rejectDisposableDomains);
    setEntries(settled.settings.entries);
    setSavedCount((count) => count + 1);
    setListAvailable(settled.disposableDomainListAvailable);
  });

  const entryError = (value: string) => {
    const entry = value.trim();
    return entry === "" || isEmailRejectionEntry(entry)
      ? undefined
      : t("admin.settings.email_rejection.validation.entry_invalid", {
          entry,
        });
  };

  const listError = (values: readonly string[]) => {
    const list = parseEmailRejectionEntries(values);
    if (!list.ok && list.reason === "too_many") {
      return t("admin.settings.email_rejection.validation.too_many", {
        max: MAX_EMAIL_REJECTION_ENTRIES,
      });
    }
    return state?.ok === false ? state.fieldErrors?.entries : undefined;
  };

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

      <EntryListFields
        addLabel={
          <ClientMessage message="admin.settings.email_rejection.entries_add" />
        }
        description={
          <ClientMessage message="admin.settings.email_rejection.entries_description" />
        }
        entryError={entryError}
        entryLabel={(position) =>
          t("admin.settings.email_rejection.entry_label", { position })
        }
        initialEntries={entries}
        key={savedCount}
        legend={
          <ClientMessage message="admin.settings.email_rejection.entries_label" />
        }
        listError={listError}
        name="entries"
        removeLabel={(position) =>
          t("admin.settings.email_rejection.entry_remove", { position })
        }
      />
    </>
  );
};
