"use client";

import type { DragEndEvent } from "@dnd-kit/react";
import { CloseIcon, PlusIcon } from "@publira/icons";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { useCallback, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { ClientMessage, useClientMessages } from "#components/client-message";
import * as Sortable from "#components/sortable-list";
import {
  bookstoreLinkFieldName,
  MAX_VOLUME_BOOKSTORE_LINKS,
} from "#lib/volume-bookstore-links";

interface BookstoreLink {
  label: string;
  url: string;
}

/** A link as the editor holds it, keyed so a row keeps its fields when moved. */
interface BookstoreLinkRow extends BookstoreLink {
  key: string;
}

interface VolumeBookstoreLinksEditorProps {
  /**
   * The links the volume has, read once. The list is this editor's own state
   * from then on, and what the form posts is the hidden field below.
   */
  initialLinks: BookstoreLink[];
}

const rowKey = (row: BookstoreLinkRow): string => row.key;

interface VolumeBookstoreLinkRowProps {
  index: number;
  onChange: (next: BookstoreLink) => void;
  onRemove: () => void;
  row: BookstoreLinkRow;
}

const VolumeBookstoreLinkRow = ({
  index,
  onChange,
  onRemove,
  row,
}: VolumeBookstoreLinkRowProps) => {
  const t = useClientMessages();
  const { pending } = useFormStatus();
  const number = index + 1;

  // The row is announced by the label typed into it, or by its place in the
  // list while it has none.
  const name =
    row.label.trim() ||
    t("admin.series.volumes.bookstore_links.row_name", { number });

  return (
    <Sortable.Item
      className="flex items-start gap-2 border border-border bg-background px-2 py-2 sm:gap-3 sm:px-3"
      disabled={pending}
      id={row.key}
      index={index}
      label={name}
    >
      <Sortable.ItemHandle className="mt-7 h-9">
        <ClientMessage
          message="admin.series.volumes.bookstore_links.reorder"
          values={{ name }}
        />
      </Sortable.ItemHandle>
      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field.Root>
          <Field.Label>
            <ClientMessage message="admin.series.volumes.bookstore_links.label" />
          </Field.Label>
          <Field.Content>
            <Input
              onChange={(event) =>
                onChange({ label: event.target.value, url: row.url })
              }
              value={row.label}
            />
            <ActionForm.FieldError
              name={bookstoreLinkFieldName(index, "label")}
            />
          </Field.Content>
        </Field.Root>
        <Field.Root>
          <Field.Label>
            <ClientMessage message="admin.series.volumes.bookstore_links.url" />
          </Field.Label>
          <Field.Content>
            <Input
              inputMode="url"
              onChange={(event) =>
                onChange({ label: row.label, url: event.target.value })
              }
              placeholder="https://"
              value={row.url}
            />
            <ActionForm.FieldError
              name={bookstoreLinkFieldName(index, "url")}
            />
          </Field.Content>
        </Field.Root>
      </div>
      <Button
        className="mt-7 shrink-0"
        disabled={pending}
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <CloseIcon aria-hidden="true" className="size-4" />
        <span className="sr-only">
          <ClientMessage
            message="admin.series.volumes.bookstore_links.remove"
            values={{ name }}
          />
        </span>
      </Button>
    </Sortable.Item>
  );
};

/**
 * The volume's bookstore links, in the order the series page lists them, and
 * the controls that add, take out, and arrange them.
 *
 * Nothing is written until the form is saved, since `SetVolumeBookstoreLinks`
 * replaces the whole list: a link moved and another added go up together.
 */
export const VolumeBookstoreLinksEditor = ({
  initialLinks,
}: VolumeBookstoreLinksEditorProps) => {
  const t = useClientMessages();
  const { pending } = useFormStatus();

  // Seeded once per mount: the form keys this editor by the list it was read
  // with, so a save remounts it on what the API stored.
  const [rows, setRows] = useState<BookstoreLinkRow[]>(() =>
    initialLinks.map((link, index) => ({ ...link, key: `saved-${index}` }))
  );

  const nextKey = useRef(0);
  const full = rows.length >= MAX_VOLUME_BOOKSTORE_LINKS;

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setRows((current) => Sortable.withItemMoved(current, rowKey, event));
  }, []);

  const handleAdd = () => {
    nextKey.current += 1;
    const key = `added-${nextKey.current}`;

    setRows((current) =>
      current.length >= MAX_VOLUME_BOOKSTORE_LINKS
        ? current
        : [...current, { key, label: "", url: "" }]
    );
  };

  const handleChange = (key: string, next: BookstoreLink) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...next } : row))
    );
  };

  const handleRemove = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
  };

  return (
    <div className="grid gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <ClientMessage message="admin.series.volumes.bookstore_links.none" />
        </p>
      ) : (
        <Sortable.Root
          aria-label={t("admin.series.volumes.bookstore_links.title")}
          className="grid gap-2"
          onDragEnd={handleDragEnd}
        >
          {rows.map((row, index) => (
            <VolumeBookstoreLinkRow
              index={index}
              key={row.key}
              onChange={(next) => handleChange(row.key, next)}
              onRemove={() => handleRemove(row.key)}
              row={row}
            />
          ))}
        </Sortable.Root>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={pending || full}
          onClick={handleAdd}
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          <ClientMessage message="admin.series.volumes.bookstore_links.add" />
        </Button>
        {full ? (
          <p className="text-xs text-muted-foreground">
            <ClientMessage
              message="admin.series.volumes.bookstore_links.limit"
              values={{ max: MAX_VOLUME_BOOKSTORE_LINKS }}
            />
          </p>
        ) : null}
      </div>

      <input
        name="bookstore_links"
        type="hidden"
        value={JSON.stringify(
          rows.map((row) => ({ label: row.label, url: row.url }))
        )}
      />
    </div>
  );
};
