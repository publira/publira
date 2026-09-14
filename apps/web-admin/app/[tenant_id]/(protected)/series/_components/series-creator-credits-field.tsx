"use client";

import { toIntlLocale } from "@publira/i18n";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Suspense,
  useCallback,
  useContext,
  useId,
  useMemo,
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

/** Where a move button sends the credit it sits on. */
type MoveDirection = -1 | 1;

/**
 * The roles each creator is already credited in. The pair is the identity of a
 * credit, so a role a creator holds is not offered for that creator a second
 * time — which is the whole of the duplicate check the API also enforces.
 */
const toRolesByCreator = (
  credits: SeriesCreatorCredit[]
): Map<string, Set<string>> => {
  const held = new Map<string, Set<string>>();
  for (const credit of credits) {
    const roles = held.get(credit.creatorPublicId) ?? new Set<string>();
    roles.add(credit.rolePublicId);
    held.set(credit.creatorPublicId, roles);
  }
  return held;
};

/**
 * Role priority order, keeping the order the editor gave inside each role.
 *
 * `toSorted` is stable, so moving one of two artists past the other survives
 * the sort. The API orders a save the same way and stores the position as
 * `display_order`, so the list on screen is the list the series reads back as.
 */
const orderCredits = (
  credits: SeriesCreatorCredit[],
  creatorRoles: CreatorRoleOption[]
): SeriesCreatorCredit[] => {
  const priority = new Map(
    creatorRoles.map((role, index) => [role.publicId, index])
  );
  // A role the tenant's list does not name sorts last rather than to the top.
  const rank = (credit: SeriesCreatorCredit): number =>
    priority.get(credit.rolePublicId) ?? creatorRoles.length;

  return credits.toSorted((left, right) => rank(left) - rank(right));
};

/**
 * The roles offered for one creator: every role of the tenant except the ones
 * that creator already holds, plus the role this row itself states.
 */
const toRoleItems = (
  creatorRoles: CreatorRoleOption[],
  heldRoles: Set<string> | undefined,
  currentRolePublicId: string
): { label: string; value: string }[] =>
  creatorRoles.flatMap((role) =>
    role.publicId === currentRolePublicId || !heldRoles?.has(role.publicId)
      ? [{ label: role.name, value: role.publicId }]
      : []
  );

/**
 * The search slot of the creator picker. Its own component because
 * `placeholder` cannot be a node: only this element waits on the catalog, and
 * the fallback is the same input without the hint.
 */
const CreatorComboboxInput = () => {
  const t = useClientMessages();

  return <ComboboxInput placeholder={t("admin.series.form.creators_search")} />;
};

interface CreatorCreditRowProps {
  canMoveDown: boolean;
  canMoveUp: boolean;
  creatorName: string;
  onMove: (direction: MoveDirection) => void;
  onRemove: () => void;
  onRoleChange: (nextRolePublicId: string) => void;
  roleItems: { label: string; value: string }[];
  rolePublicId: string;
}

/**
 * One credit: who, in what role, and where it sits among the credits sharing
 * that role.
 *
 * A component of its own because the role select needs an id for its label to
 * point at, and `useId` cannot be called from inside the list's `map`. Each
 * button is named by the text inside it rather than by an `aria-label`, so the
 * copy keeps a boundary of its own and the control is usable before the
 * catalog arrives.
 */
const CreatorCreditRow = ({
  canMoveDown,
  canMoveUp,
  creatorName,
  onMove,
  onRemove,
  onRoleChange,
  roleItems,
  rolePublicId,
}: CreatorCreditRowProps) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  return (
    <li className="grid gap-2 border border-border bg-background px-3 py-2 sm:flex sm:items-center sm:gap-3">
      <p className="flex-1 text-sm text-foreground">{creatorName}</p>
      <Field className="sm:w-48">
        <FieldLabel className="sr-only" htmlFor={selectId}>
          <Suspense fallback={null}>
            <ClientMessage
              message="admin.series.form.creators_role_field_label"
              values={{ name: creatorName }}
            />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            id={selectId}
            items={roleItems}
            onValueChange={onRoleChange}
            value={rolePublicId}
          />
        </FieldContent>
      </Field>
      <div className="flex items-center gap-2">
        <Button
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronUpIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">
            <Suspense fallback={null}>
              <ClientMessage
                message="admin.series.form.creators_move_up"
                values={{ name: creatorName }}
              />
            </Suspense>
          </span>
        </Button>
        <Button
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          size="icon"
          type="button"
          variant="outline"
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">
            <Suspense fallback={null}>
              <ClientMessage
                message="admin.series.form.creators_move_down"
                values={{ name: creatorName }}
              />
            </Suspense>
          </span>
        </Button>
        <Button onClick={onRemove} size="icon" type="button" variant="outline">
          <CloseIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">
            <Suspense fallback={null}>
              <ClientMessage
                message="admin.series.form.creators_remove"
                values={{ name: creatorName }}
              />
            </Suspense>
          </span>
        </Button>
      </div>
    </li>
  );
};

interface SeriesCreatorCreditsFieldProps {
  creatorRoles: CreatorRoleOption[];
  creatorRolesErrorMessage?: string;
  creators: CreatorOption[];
  creatorsErrorMessage?: string;
  onChange: (next: SeriesCreatorCredit[]) => void;
  value: SeriesCreatorCredit[];
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
  onChange,
  value,
}: SeriesCreatorCreditsFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  // `Combobox` and `Select` render their own controls instead of a Field
  // control, so each label needs an id to point at.
  const creatorComboboxId = useId();
  const roleSelectId = useId();
  const [draftCreatorPublicId, setDraftCreatorPublicId] = useState("");
  const [draftRolePublicId, setDraftRolePublicId] = useState(
    () => creatorRoles.at(0)?.publicId ?? ""
  );
  // Bumped on every add, and the picker's `key`, so the creator just credited
  // is not left written in the search box.
  const [addedCount, setAddedCount] = useState(0);

  const creatorItems = useMemo(
    () =>
      creators
        .map((creator) => ({ label: creator.name, value: creator.publicId }))
        .toSorted((left, right) =>
          left.label.localeCompare(right.label, toIntlLocale(locale))
        ),
    [creators, locale]
  );
  const creatorNames = useMemo(
    () => new Map(creators.map((creator) => [creator.publicId, creator.name])),
    [creators]
  );
  const orderedCredits = useMemo(
    () => orderCredits(value, creatorRoles),
    [creatorRoles, value]
  );
  const heldRoles = useMemo(() => toRolesByCreator(value), [value]);

  const draftRoleItems = toRoleItems(
    creatorRoles,
    heldRoles.get(draftCreatorPublicId),
    ""
  );
  // Choosing another creator can take the drafted role out of the offer, so
  // the select falls back to the first one still on it rather than showing a
  // role the Add button would refuse.
  const effectiveDraftRolePublicId = draftRoleItems.some(
    (item) => item.value === draftRolePublicId
  )
    ? draftRolePublicId
    : (draftRoleItems.at(0)?.value ?? "");

  const handleDraftRoleChange = useCallback((next: string) => {
    setDraftRolePublicId(next);
  }, []);

  const handleAdd = useCallback(() => {
    if (!(draftCreatorPublicId && effectiveDraftRolePublicId)) {
      return;
    }
    onChange([
      ...orderedCredits,
      {
        creatorPublicId: draftCreatorPublicId,
        rolePublicId: effectiveDraftRolePublicId,
      },
    ]);
    setDraftCreatorPublicId("");
    setAddedCount((current) => current + 1);
  }, [
    draftCreatorPublicId,
    effectiveDraftRolePublicId,
    onChange,
    orderedCredits,
  ]);

  const handleMove = useCallback(
    (index: number, direction: MoveDirection) => {
      const target = index + direction;
      const moved = [...orderedCredits];
      const [credit] = moved.splice(index, 1);
      moved.splice(target, 0, credit);
      onChange(moved);
    },
    [onChange, orderedCredits]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(orderedCredits.filter((_credit, current) => current !== index));
    },
    [onChange, orderedCredits]
  );

  const handleRoleChange = useCallback(
    (index: number, nextRolePublicId: string) => {
      onChange(
        orderedCredits.map((credit, current) =>
          current === index
            ? { ...credit, rolePublicId: nextRolePublicId }
            : credit
        )
      );
    },
    [onChange, orderedCredits]
  );

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

      {orderedCredits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creators_none" />
          </Suspense>
        </p>
      ) : (
        <ul className="grid gap-2">
          {orderedCredits.map((credit, index) => {
            const creatorName =
              creatorNames.get(credit.creatorPublicId) ??
              credit.creatorPublicId;
            return (
              <CreatorCreditRow
                canMoveDown={
                  orderedCredits.at(index + 1)?.rolePublicId ===
                  credit.rolePublicId
                }
                canMoveUp={
                  index > 0 &&
                  orderedCredits.at(index - 1)?.rolePublicId ===
                    credit.rolePublicId
                }
                creatorName={creatorName}
                key={`${credit.creatorPublicId}-${credit.rolePublicId}`}
                onMove={(direction) => handleMove(index, direction)}
                onRemove={() => handleRemove(index)}
                onRoleChange={(nextRolePublicId) =>
                  handleRoleChange(index, nextRolePublicId)
                }
                roleItems={toRoleItems(
                  creatorRoles,
                  heldRoles.get(credit.creatorPublicId),
                  credit.rolePublicId
                )}
                rolePublicId={credit.rolePublicId}
              />
            );
          })}
        </ul>
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

      {creatorItems.length > 0 && creatorRoles.length > 0 ? (
        <div className="grid gap-2 sm:flex sm:items-end sm:gap-3">
          <Field className="flex-1">
            <FieldLabel htmlFor={creatorComboboxId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <ClientMessage message="admin.series.form.creators_add_creator" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Combobox
                id={creatorComboboxId}
                items={creatorItems}
                key={addedCount}
                onValueChange={setDraftCreatorPublicId}
                value={draftCreatorPublicId}
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
          <Field className="sm:w-48">
            <FieldLabel htmlFor={roleSelectId}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <ClientMessage message="admin.series.form.creators_add_role" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Select
                id={roleSelectId}
                items={draftRoleItems}
                onValueChange={handleDraftRoleChange}
                value={effectiveDraftRolePublicId}
              />
            </FieldContent>
          </Field>
          <Button
            disabled={!(draftCreatorPublicId && effectiveDraftRolePublicId)}
            onClick={handleAdd}
            type="button"
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <ClientMessage message="admin.series.form.creators_add" />
            </Suspense>
          </Button>
        </div>
      ) : null}

      {draftCreatorPublicId && draftRoleItems.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <ClientMessage message="admin.series.form.creators_all_roles_taken" />
          </Suspense>
        </p>
      ) : null}

      {/* The whole list as one field: the pair is the identity of a credit,
          and two repeated fields would arrive as two lists to zip back
          together. */}
      <input
        name="creator_credits"
        type="hidden"
        value={JSON.stringify(orderedCredits)}
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
