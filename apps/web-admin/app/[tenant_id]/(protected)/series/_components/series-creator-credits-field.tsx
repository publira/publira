"use client";

import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { toIntlLocale } from "@publira/i18n";
import { CloseIcon, GripVerticalIcon, PlusIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import {
  Suspense,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";

import type { SeriesCreatorCredit } from "../series-types";

export interface CreatorOption {
  publicId: string;
  name: string;
}

export interface CreatorRoleOption {
  publicId: string;
  name: string;
}

/**
 * One row of the editor.
 *
 * A row exists before it says anything: pressing Add opens an empty one, and
 * what it holds is chosen afterwards. `key` is what identifies it while that
 * is still true — the credit itself cannot, because a row with no author yet
 * is indistinguishable from the next one.
 */
interface CreditRow {
  key: string;
  creatorPublicId: string;
  rolePublicId: string;
}

/** A row says something only once it names both halves of a credit. */
const isComplete = (row: CreditRow): boolean =>
  row.creatorPublicId.length > 0 && row.rolePublicId.length > 0;

/**
 * The rows the editor opens on, in the order the API read them back: role
 * priority first, then the position inside a role.
 *
 * Nothing re-sorts them after that. The API orders a save by role priority and
 * stores the position as `display_order`, so the grouping is restored on the
 * next read — and a row that sorted itself the moment its author was chosen
 * would move out from under the editor mid-edit.
 *
 * A credit written before roles existed states none, and a save has no way to
 * say that, so it opens on the tenant's leading role — where the editor sees
 * it and can change it before saving.
 */
const toInitialRows = (
  credits: SeriesCreatorCredit[],
  creatorRoles: CreatorRoleOption[]
): CreditRow[] => {
  const leadingRolePublicId = creatorRoles.at(0)?.publicId ?? "";

  return credits.map((credit, index) => ({
    creatorPublicId: credit.creatorPublicId,
    key: String(index),
    rolePublicId: credit.rolePublicId || leadingRolePublicId,
  }));
};

/**
 * The roles one row may state: every role of the tenant except the ones the
 * author on this row already holds on another row. The pair is the identity of
 * a credit, so a role that would repeat one is not offered rather than
 * refused — which is the whole of the duplicate check the API also enforces.
 */
const toRoleItems = (
  rows: CreditRow[],
  creatorRoles: CreatorRoleOption[],
  row: CreditRow
): ComboboxItem[] => {
  const heldElsewhere = new Set(
    rows.flatMap((other) =>
      other.key !== row.key && other.creatorPublicId === row.creatorPublicId
        ? [other.rolePublicId]
        : []
    )
  );

  return creatorRoles.flatMap((role) =>
    heldElsewhere.has(role.publicId)
      ? []
      : [{ label: role.name, value: role.publicId }]
  );
};

/** The role a row ends up stating, which is the one it can still be given. */
const toResolvedRolePublicId = (
  roleItems: ComboboxItem[],
  rolePublicId: string
): string =>
  roleItems.some((item) => item.value === rolePublicId)
    ? rolePublicId
    : (roleItems.at(0)?.value ?? "");

/**
 * The search slot of the author picker. Its own component because
 * `placeholder` cannot be a node: only this element waits on the catalog, and
 * the fallback is the same input without the hint.
 */
const CreatorComboboxInput = () => {
  const t = useClientMessages();

  return <ComboboxInput placeholder={t("admin.series.form.creators_search")} />;
};

/** The search slot of a role picker, for the reason above. */
const RoleComboboxInput = () => {
  const t = useClientMessages();

  return (
    <ComboboxInput placeholder={t("admin.series.form.creators_role_search")} />
  );
};

interface CreatorCreditRowProps {
  creatorItems: ComboboxItem[];
  creatorPublicId: string;
  id: string;
  index: number;
  onCreatorChange: (nextCreatorPublicId: string) => void;
  onRemove: () => void;
  onRoleChange: (nextRolePublicId: string) => void;
  position: number;
  roleItems: ComboboxItem[];
  rolePublicId: string;
}

/**
 * One credit: who, in what role, and where it sits among the credits sharing
 * that role. Both halves stay editable, so correcting a credit is changing the
 * row rather than deleting it and writing it again.
 *
 * A component of its own because each picker needs an id for its label to
 * point at, and `useId` cannot be called from inside the list's `map`. Neither
 * picker carries a visible label — the value in the box is the answer, and the
 * placeholder says what is being asked — so the accessible name comes from a
 * visually hidden one naming the row's position.
 *
 * The row is dragged by its handle alone, so the pickers inside it still take
 * a pointer, and the handle is focusable so the keyboard sensor can move the
 * row without a pointer at all. `type` and `accept` are the role, which is
 * what keeps a drag inside one role: the editor orders the artists among
 * themselves, and the roles themselves are ordered on the author roles page.
 */
const CreatorCreditRow = ({
  creatorItems,
  creatorPublicId,
  id,
  index,
  onCreatorChange,
  onRemove,
  onRoleChange,
  position,
  roleItems,
  rolePublicId,
}: CreatorCreditRowProps) => {
  const creatorComboboxId = useId();
  const roleComboboxId = useId();
  const { handleRef, isDragging, ref } = useSortable({
    accept: rolePublicId,
    id,
    index,
    type: rolePublicId,
  });

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 border border-border bg-background px-2 py-2 sm:flex-nowrap sm:gap-3 sm:px-3",
        isDragging && "opacity-60"
      )}
      ref={ref}
    >
      <button
        className="shrink-0 cursor-grab touch-none rounded-control p-1 text-muted-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        ref={handleRef}
        type="button"
      >
        <GripVerticalIcon aria-hidden="true" className="size-4" />
        {/* The handle's own name, as a node rather than an `aria-label`, so the
            copy keeps a boundary of its own. */}
        <span className="sr-only">
          <Suspense fallback={null}>
            <ClientMessage
              message="admin.series.form.creators_reorder"
              values={{ position: String(position) }}
            />
          </Suspense>
        </span>
      </button>
      <Field className="min-w-40 flex-1">
        <FieldLabel className="sr-only" htmlFor={creatorComboboxId}>
          <Suspense fallback={null}>
            <ClientMessage
              message="admin.series.form.creators_creator_field_label"
              values={{ position: String(position) }}
            />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={creatorComboboxId}
            items={creatorItems}
            onValueChange={onCreatorChange}
            value={creatorPublicId}
          >
            <Suspense fallback={<ComboboxInput />}>
              <CreatorComboboxInput />
            </Suspense>
            <ComboboxPopup>
              <ComboboxEmpty>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <ClientMessage message="admin.series.form.creators_no_match" />
                </Suspense>
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
      <Field className="min-w-32 flex-1 sm:max-w-48">
        <FieldLabel className="sr-only" htmlFor={roleComboboxId}>
          <Suspense fallback={null}>
            <ClientMessage
              message="admin.series.form.creators_role_field_label"
              values={{ position: String(position) }}
            />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={roleComboboxId}
            items={roleItems}
            onValueChange={onRoleChange}
            value={rolePublicId}
          >
            <Suspense fallback={<ComboboxInput />}>
              <RoleComboboxInput />
            </Suspense>
            <ComboboxPopup>
              <ComboboxEmpty>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <ClientMessage message="admin.series.form.creators_role_no_match" />
                </Suspense>
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
      <Button
        className="shrink-0"
        onClick={onRemove}
        size="icon"
        type="button"
        variant="outline"
      >
        <CloseIcon aria-hidden="true" className="size-4" />
        <span className="sr-only">
          <Suspense fallback={null}>
            <ClientMessage
              message="admin.series.form.creators_remove"
              values={{ position: String(position) }}
            />
          </Suspense>
        </span>
      </Button>
    </li>
  );
};

interface SeriesCreatorCreditsFieldProps {
  creatorRoles: CreatorRoleOption[];
  creatorRolesErrorMessage?: string;
  creators: CreatorOption[];
  creatorsErrorMessage?: string;
  /**
   * The credits the series holds, read once. The rows are this field's own
   * state from then on, and what the form posts is the hidden field below —
   * so a half-written row stays on screen without the rest of the form having
   * to know about it.
   */
  initialCredits: SeriesCreatorCredit[];
}

/**
 * Who the series is credited to, and in what capacity.
 *
 * This list is the template an episode is created from: editing it changes
 * what the next episode is baked with and leaves the episodes that already
 * exist with the team they shipped with, which is what the note under the list
 * says.
 *
 * A `fieldset` rather than a `Field`, because the group holds several controls
 * and a single `<label>` would have nothing to point at.
 */
export const SeriesCreatorCreditsField = ({
  creatorRoles,
  creatorRolesErrorMessage,
  creators,
  creatorsErrorMessage,
  initialCredits,
}: SeriesCreatorCreditsFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  // Seeded once per mount: the edit route keys this form by the series' public
  // id, so switching to another series remounts it with that series' credits.
  const [rows, setRows] = useState(() =>
    toInitialRows(initialCredits, creatorRoles)
  );
  // Only ever identifies a row, so it is never drawn and does not belong in
  // state: bumping it must not redraw the list.
  const nextRowKey = useRef(initialCredits.length);

  const creatorItems = useMemo<ComboboxItem[]>(
    () =>
      creators
        .map((creator) => ({ label: creator.name, value: creator.publicId }))
        .toSorted((left, right) =>
          left.label.localeCompare(right.label, toIntlLocale(locale))
        ),
    [creators, locale]
  );
  // The role each row can still be given, resolved before anything is drawn,
  // so the list on screen is the list the form posts.
  const resolvedRows = rows.map((row) => {
    const roleItems = toRoleItems(rows, creatorRoles, row);
    return {
      ...row,
      roleItems,
      rolePublicId: toResolvedRolePublicId(roleItems, row.rolePublicId),
    };
  });
  const credits = resolvedRows.flatMap((row) =>
    isComplete(row)
      ? [
          {
            creatorPublicId: row.creatorPublicId,
            rolePublicId: row.rolePublicId,
          },
        ]
      : []
  );
  const hasExhaustedAuthor = resolvedRows.some(
    (row) => row.creatorPublicId.length > 0 && row.rolePublicId.length === 0
  );

  const handleAdd = useCallback(() => {
    const key = String(nextRowKey.current);
    nextRowKey.current += 1;
    setRows((currentRows) => [
      ...currentRows,
      {
        creatorPublicId: "",
        key,
        rolePublicId: creatorRoles.at(0)?.publicId ?? "",
      },
    ]);
  }, [creatorRoles]);

  /**
   * A drop reorders the rows, so the list the form posts is the list the
   * editor just dragged into place.
   */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setRows((currentRows) => {
      const currentKeys = currentRows.map((row) => row.key);
      const nextKeys = move(currentKeys, event);
      if (nextKeys === currentKeys) {
        return currentRows;
      }
      const byKey = new Map(currentRows.map((row) => [row.key, row]));
      return nextKeys.flatMap((key) => {
        const row = byKey.get(key);
        return row ? [row] : [];
      });
    });
  }, []);

  const handleRemove = useCallback((key: string) => {
    setRows((currentRows) => currentRows.filter((row) => row.key !== key));
  }, []);

  /**
   * Changing who a row credits can take its role out of the offer — the new
   * author may already hold it on another row — so the role is resolved and
   * written here rather than left to differ from what is on screen.
   */
  const handleCreatorChange = useCallback(
    (key: string, nextCreatorPublicId: string) => {
      setRows((currentRows) =>
        currentRows.map((row) => {
          if (row.key !== key) {
            return row;
          }
          const next = { ...row, creatorPublicId: nextCreatorPublicId };
          return {
            ...next,
            rolePublicId: toResolvedRolePublicId(
              toRoleItems(currentRows, creatorRoles, next),
              row.rolePublicId
            ),
          };
        })
      );
    },
    [creatorRoles]
  );

  const handleRoleChange = useCallback(
    (key: string, nextRolePublicId: string) => {
      setRows((currentRows) =>
        currentRows.map((row) =>
          row.key === key ? { ...row, rolePublicId: nextRolePublicId } : row
        )
      );
    },
    []
  );

  const canAdd = creatorItems.length > 0 && creatorRoles.length > 0;

  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <ClientMessage message="admin.series.form.creators" />
        </Suspense>
      </legend>

      {creatorsErrorMessage ? (
        <FormMessage variant="destructive">{creatorsErrorMessage}</FormMessage>
      ) : null}
      {creatorRolesErrorMessage ? (
        <FormMessage variant="destructive">
          {creatorRolesErrorMessage}
        </FormMessage>
      ) : null}

      {resolvedRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creators_none" />
          </Suspense>
        </p>
      ) : (
        <DragDropProvider onDragEnd={handleDragEnd}>
          <ul className="grid gap-2">
            {resolvedRows.map((row, index) => (
              <CreatorCreditRow
                creatorItems={creatorItems}
                creatorPublicId={row.creatorPublicId}
                id={row.key}
                index={index}
                key={row.key}
                onCreatorChange={(nextCreatorPublicId) =>
                  handleCreatorChange(row.key, nextCreatorPublicId)
                }
                onRemove={() => handleRemove(row.key)}
                onRoleChange={(nextRolePublicId) =>
                  handleRoleChange(row.key, nextRolePublicId)
                }
                position={index + 1}
                roleItems={row.roleItems}
                rolePublicId={row.rolePublicId}
              />
            ))}
          </ul>
        </DragDropProvider>
      )}

      {creatorItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creators_empty" />
          </Suspense>
        </p>
      ) : null}
      {creatorRoles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creator_roles_empty" />
          </Suspense>
        </p>
      ) : null}
      {hasExhaustedAuthor ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creators_all_roles_taken" />
          </Suspense>
        </p>
      ) : null}

      {canAdd ? (
        <div>
          <Button onClick={handleAdd} type="button" variant="outline">
            <PlusIcon aria-hidden="true" className="size-4" />
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <ClientMessage message="admin.series.form.creators_add" />
            </Suspense>
          </Button>
        </div>
      ) : null}

      {/* The whole list as one field: the pair is the identity of a credit,
          and two repeated fields would arrive as two lists to zip back
          together. A row that names only half of one is not a credit yet, so
          it waits here rather than failing the save. */}
      <input
        name="creator_credits"
        type="hidden"
        value={JSON.stringify(credits)}
      />

      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <ClientMessage message="admin.series.form.creators_description" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <ClientMessage message="admin.series.form.creators_template_note" />
        </Suspense>
      </p>
    </fieldset>
  );
};
