"use client";

import { CloseIcon, PlusIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { Field } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { ClipboardEvent, ReactNode } from "react";
import { useState } from "react";

/** One input of the list. `id` keys it, so a removed field takes its value with it. */
interface EntryRow {
  id: number;
  value: string;
  /** Whether the operator has left it, which is when its value is checked. */
  touched: boolean;
}

/** The entries, one field each, or one empty field to type into. */
const toRows = (entries: readonly string[]): EntryRow[] =>
  (entries.length > 0 ? entries : [""]).map((value, id) => ({
    id,
    touched: false,
    value,
  }));

const nextRowId = (rows: readonly EntryRow[]): number =>
  Math.max(-1, ...rows.map((row) => row.id)) + 1;

/** The entries a pasted text names, one a line, trimmed, blank lines dropped. */
export const splitPastedEntries = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** Focuses the field it is attached to, as it mounts. */
const focusOnMount = (input: HTMLInputElement | null) => {
  input?.focus();
};

interface EntryListFieldsProps {
  /**
   * The entries the list opens on. The fields are the list's own from then
   * on, so a caller shows a new list by remounting it with a changed `key`.
   */
  initialEntries: readonly string[];
  /** The name every field submits under, blank ones included. */
  name: string;
  legend: ReactNode;
  description: ReactNode;
  addLabel: ReactNode;
  /** The accessible name of the field at `position`, counted from 1. */
  entryLabel: (position: string) => string;
  /** The accessible name of the button that removes the field at `position`. */
  removeLabel: (position: string) => string;
  /** What is wrong with one field's value, or `undefined` when nothing is. */
  entryError: (value: string) => string | undefined;
  /** What is wrong with the list as a whole, given every field's value. */
  listError: (values: readonly string[]) => string | undefined;
}

/**
 * A list the operator types one entry per field into. Each field is checked
 * once the operator leaves it, so an entry the server would refuse is named
 * before the round trip. A paste of several lines into one field becomes one
 * field per line.
 */
export const EntryListFields = ({
  addLabel,
  description,
  entryError,
  entryLabel,
  initialEntries,
  legend,
  listError,
  name,
  removeLabel,
}: EntryListFieldsProps) => {
  const [rows, setRows] = useState(() => toRows(initialEntries));
  // The field a click or a paste just added, which takes the focus.
  const [focusRowId, setFocusRowId] = useState<number | null>(null);

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
    const [first, ...rest] = splitPastedEntries(
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

  const listMessage = listError(rows.map((row) => row.value));

  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 text-sm font-medium text-foreground">
        {legend}
      </legend>

      {rows.map((row, index) => {
        const position = String(index + 1);
        const message = row.touched ? entryError(row.value) : undefined;

        return (
          <div className="flex items-start gap-2" key={row.id}>
            <Field className="min-w-0 flex-1" invalid={message !== undefined}>
              <Input
                aria-label={entryLabel(position)}
                autoCapitalize="none"
                name={name}
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
              {message === undefined ? null : (
                <FormMessage variant="destructive">{message}</FormMessage>
              )}
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
              <span className="sr-only">{removeLabel(position)}</span>
            </Button>
          </div>
        );
      })}

      <div>
        <Button onClick={addRow} type="button" variant="outline">
          <PlusIcon aria-hidden="true" className="size-4" />
          {addLabel}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{description}</p>

      {listMessage === undefined ? null : (
        <FormMessage variant="destructive">{listMessage}</FormMessage>
      )}
    </fieldset>
  );
};
