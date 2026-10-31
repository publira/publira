"use client";

import { CloseIcon, PlusIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { InputProps } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ClipboardEvent, ReactNode } from "react";

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

const withRowChanged = (
  rows: readonly EntryRow[],
  id: number,
  change: Partial<Omit<EntryRow, "id">>
): EntryRow[] =>
  rows.map((row) => (row.id === id ? { ...row, ...change } : row));

/** The entries a pasted text names, one a line, trimmed, blank lines dropped. */
const splitPastedEntries = (text: string): string[] =>
  text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** Focuses the field it is attached to, as it mounts. */
const focusOnMount = (input: HTMLInputElement | null) => {
  input?.focus();
};

interface EntryListContextValue {
  rows: readonly EntryRow[];
  focusRowId: number | null;
  addRow: () => void;
  removeRow: (id: number) => void;
  updateRow: (id: number, change: Partial<Omit<EntryRow, "id">>) => void;
  pasteInto: (id: number, event: ClipboardEvent<HTMLInputElement>) => void;
}

const EntryListContext = createContext<EntryListContextValue | null>(null);

const useEntryListContext = (): EntryListContextValue => {
  const context = use(EntryListContext);

  if (!context) {
    throw new Error("An entry list slot must sit inside <EntryList>.");
  }

  return context;
};

/** The row a slot of `<EntryListRows>` renders. */
interface EntryListRowValue {
  id: number;
  /** The row's place in the list, counted from 1, for its accessible names. */
  position: string;
  value: string;
  touched: boolean;
}

const EntryListRowContext = createContext<EntryListRowValue | null>(null);

/**
 * The row the calling slot sits in: its position for the accessible names the
 * caller writes, and its value for the message the caller words.
 */
const useEntryListRow = (): EntryListRowValue => {
  const row = use(EntryListRowContext);

  if (!row) {
    throw new Error("useEntryListRow must be called inside <EntryListRows>.");
  }

  return row;
};

/** Every field's value, in order, for a message about the list as a whole. */
const useEntryListValues = (): string[] =>
  useEntryListContext().rows.map((row) => row.value);

/**
 * A list the operator types one entry per field into. Each field is checked
 * once the operator leaves it, so an entry the server would refuse is named
 * before the round trip. A paste of several lines into one field becomes one
 * field per line.
 *
 * The fields are the list's own once it mounts, so a caller shows a new list
 * by remounting it with a changed `key`. Every piece of copy is the caller's,
 * written into the slots: `EntryListLegend`, `EntryListRows` (with
 * `EntryListField`, `EntryListInput`, and `EntryListRemove` for each row),
 * `EntryListAdd`, and `EntryListDescription`.
 */
const EntryList = ({
  children,
  initialEntries,
}: {
  children: ReactNode;
  initialEntries: readonly string[];
}) => {
  const [rows, setRows] = useState(() => toRows(initialEntries));
  // The field a click or a paste just added, which takes the focus.
  const [focusRowId, setFocusRowId] = useState<number | null>(null);

  const context = useMemo(() => {
    const updateRow = (id: number, change: Partial<Omit<EntryRow, "id">>) => {
      setRows((current) => withRowChanged(current, id, change));
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
    const pasteInto = (id: number, event: ClipboardEvent<HTMLInputElement>) => {
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

    return { addRow, focusRowId, pasteInto, removeRow, rows, updateRow };
  }, [focusRowId, rows]);

  return (
    <EntryListContext value={context}>
      <fieldset className="grid min-w-0 gap-2">{children}</fieldset>
    </EntryListContext>
  );
};

const EntryListLegend = ({ children }: { children: ReactNode }) => (
  <legend className="mb-2 text-sm font-medium text-foreground">
    {children}
  </legend>
);

const EntryListRow = ({
  children,
  index,
  row: { id, touched, value },
}: {
  children: ReactNode;
  index: number;
  row: EntryRow;
}) => {
  const position = String(index + 1);

  const context = useMemo(
    () => ({ id, position, touched, value }),
    [id, position, touched, value]
  );

  return (
    <div className="flex items-start gap-2">
      <EntryListRowContext value={context}>{children}</EntryListRowContext>
    </div>
  );
};

/** Renders its children once per row, each with that row's context. */
const EntryListRows = ({ children }: { children: ReactNode }) => {
  const { rows } = useEntryListContext();

  return rows.map((row, index) => (
    <EntryListRow index={index} key={row.id} row={row}>
      {children}
    </EntryListRow>
  ));
};

/** The row's field: its input and the message about it. */
const EntryListField = (props: Omit<Field.RootProps, "className">) => (
  <Field.Root className="min-w-0 flex-1" {...props} />
);

/** The row's input. `name` and `aria-label` are the caller's. */
const EntryListInput = (
  props: Omit<
    InputProps,
    "onBlur" | "onChange" | "onPaste" | "ref" | "value"
  > & { "aria-label": string; name: string }
) => {
  const { focusRowId, pasteInto, updateRow } = useEntryListContext();
  const { id, value } = useEntryListRow();

  return (
    <Input
      autoCapitalize="none"
      spellCheck={false}
      {...props}
      onBlur={() => {
        updateRow(id, { touched: true });
      }}
      onChange={(event) => {
        updateRow(id, { value: event.target.value });
      }}
      onPaste={(event) => {
        pasteInto(id, event);
      }}
      ref={id === focusRowId ? focusOnMount : undefined}
      value={value}
    />
  );
};

/** The button that removes the row. Its accessible name is the caller's. */
const EntryListRemove = ({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) => {
  const { removeRow } = useEntryListContext();
  const { id } = useEntryListRow();

  return (
    <Button
      aria-label={ariaLabel}
      className="shrink-0"
      onClick={() => {
        removeRow(id);
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      <CloseIcon aria-hidden="true" className="size-4" />
    </Button>
  );
};

/** The button that adds an empty row and focuses it. */
const EntryListAdd = ({ children }: { children: ReactNode }) => {
  const { addRow } = useEntryListContext();

  return (
    <div>
      <Button onClick={addRow} type="button" variant="outline">
        <PlusIcon aria-hidden="true" className="size-4" />
        {children}
      </Button>
    </div>
  );
};

const EntryListDescription = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

/** A message about the list as a whole, shown while there is one. */
const EntryListMessage = ({ children }: { children?: string }) =>
  children === undefined ? null : (
    <FormMessage variant="destructive">{children}</FormMessage>
  );

export {
  EntryList as Root,
  EntryListAdd as Add,
  EntryListDescription as Description,
  EntryListField as Field,
  EntryListInput as Input,
  EntryListLegend as Legend,
  EntryListMessage as Message,
  EntryListRemove as Remove,
  EntryListRows as Rows,
  splitPastedEntries,
  useEntryListRow as useRow,
  useEntryListValues as useValues,
};
