"use client";

import { CloseIcon, PlusIcon } from "@publira/icons";
import {
  useActionFormSettled,
  useActionFormState,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Switch } from "@publira/ui-components/switch";
import type { ClipboardEvent } from "react";
import { useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { TenantEmailRejectionSettings } from "#lib/tenant-email-rejection-settings";
import {
  isEmailRejectionEntry,
  MAX_EMAIL_REJECTION_ENTRIES,
  parseEmailRejectionEntries,
  splitPastedEmailRejectionEntries,
} from "#lib/tenant-email-rejection-settings-shared";

import type { TenantEmailRejectionActionState } from "../settings-types";

type SettledState = NonNullable<TenantEmailRejectionActionState>;

/** One input of the list. `id` keys it, so a removed field takes its value with it. */
interface EntryRow {
  id: number;
  value: string;
  /** Whether the operator has left it, which is when its value is checked. */
  touched: boolean;
}

/** The saved entries, one field each, or one empty field to type into. */
const toRows = (entries: readonly string[]): EntryRow[] =>
  (entries.length > 0 ? entries : [""]).map((value, id) => ({
    id,
    touched: false,
    value,
  }));

const nextRowId = (rows: readonly EntryRow[]): number =>
  Math.max(-1, ...rows.map((row) => row.id)) + 1;

/** Focuses the field it is attached to, as it mounts. */
const focusOnMount = (input: HTMLInputElement | null) => {
  input?.focus();
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
  const t = useClientMessages();
  const state = useActionFormState<SettledState>();
  const [rejectDisposableDomains, setRejectDisposableDomains] = useState(
    () => initialSettings?.rejectDisposableDomains ?? false
  );
  const [rows, setRows] = useState(() =>
    toRows(initialSettings?.entries ?? [])
  );
  const [listAvailable, setListAvailable] = useState(
    () => disposableDomainListAvailable
  );
  // The field a click or a paste just added, which takes the focus.
  const [focusRowId, setFocusRowId] = useState<number | null>(null);

  useActionFormSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }
    setRejectDisposableDomains(settled.settings.rejectDisposableDomains);
    setRows(toRows(settled.settings.entries));
    setListAvailable(settled.disposableDomainListAvailable);
    setFocusRowId(null);
  });

  const updateRow = (id: number, change: Partial<Omit<EntryRow, "id">>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row))
    );
  };

  const addRow = () => {
    const id = nextRowId(rows);
    setRows([...rows, { id, touched: false, value: "" }]);
    setFocusRowId(id);
  };

  const removeRow = (id: number) => {
    const remaining = rows.filter((row) => row.id !== id);
    setRows(
      remaining.length > 0
        ? remaining
        : [{ id: nextRowId(rows), touched: false, value: "" }]
    );
  };

  // A single line is left to the browser; several lines become one field
  // each, the first taking the place of what was selected in this one.
  const handlePaste = (id: number, event: ClipboardEvent<HTMLInputElement>) => {
    const [first, ...rest] = splitPastedEmailRejectionEntries(
      event.clipboardData.getData("text")
    );
    if (first === undefined || rest.length === 0) {
      return;
    }
    event.preventDefault();
    const input = event.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const value = `${input.value.slice(0, start)}${first}${input.value.slice(end)}`;
    const firstNewId = nextRowId(rows);
    const added = rest.map((entry, index) => ({
      id: firstNewId + index,
      touched: true,
      value: entry,
    }));
    const position = rows.findIndex((row) => row.id === id);
    setRows([
      ...rows.slice(0, position),
      { id, touched: true, value },
      ...added,
      ...rows.slice(position + 1),
    ]);
    setFocusRowId(added.at(-1)?.id ?? null);
  };

  const list = parseEmailRejectionEntries(rows.map((row) => row.value));
  let listError: string | undefined;
  if (!list.ok && list.reason === "too_many") {
    listError = t("admin.settings.email_rejection.validation.too_many", {
      max: MAX_EMAIL_REJECTION_ENTRIES,
    });
  } else if (state?.ok === false) {
    listError = state.fieldErrors?.entries;
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

      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">
          <ClientMessage message="admin.settings.email_rejection.entries_label" />
        </legend>

        {rows.map((row, index) => {
          const position = String(index + 1);
          const value = row.value.trim();
          const invalid =
            row.touched && value !== "" && !isEmailRejectionEntry(value);

          return (
            <div className="flex items-start gap-2" key={row.id}>
              <Field className="min-w-0 flex-1" invalid={invalid}>
                <Input
                  aria-label={t("admin.settings.email_rejection.entry_label", {
                    position,
                  })}
                  autoCapitalize="none"
                  name="entries"
                  onBlur={() => {
                    updateRow(row.id, { touched: true });
                  }}
                  onChange={(event) => {
                    updateRow(row.id, { value: event.target.value });
                  }}
                  onPaste={(event) => {
                    handlePaste(row.id, event);
                  }}
                  ref={row.id === focusRowId ? focusOnMount : undefined}
                  spellCheck={false}
                  value={row.value}
                />
                {invalid ? (
                  <FormMessage variant="destructive">
                    <ClientMessage
                      message="admin.settings.email_rejection.validation.entry_invalid"
                      values={{ entry: value }}
                    />
                  </FormMessage>
                ) : null}
              </Field>
              <Button
                className="shrink-0"
                onClick={() => {
                  removeRow(row.id);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <CloseIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">
                  <ClientMessage
                    message="admin.settings.email_rejection.entry_remove"
                    values={{ position }}
                  />
                </span>
              </Button>
            </div>
          );
        })}

        <div>
          <Button onClick={addRow} type="button" variant="outline">
            <PlusIcon aria-hidden="true" className="size-4" />
            <ClientMessage message="admin.settings.email_rejection.entries_add" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          <ClientMessage message="admin.settings.email_rejection.entries_description" />
        </p>

        {listError === undefined ? null : (
          <FormMessage variant="destructive">{listError}</FormMessage>
        )}
      </fieldset>
    </>
  );
};
