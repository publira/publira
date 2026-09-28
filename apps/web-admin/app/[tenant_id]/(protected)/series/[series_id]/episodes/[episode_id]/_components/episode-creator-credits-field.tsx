"use client";

import { CreatorCreditSource } from "@publira/api-client/admin/types";
import { CloseIcon, PlusIcon } from "@publira/icons";
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
import { useId, useMemo, useRef, useState } from "react";

import { ClientMessage } from "#components/client-message";
import { CreditShareInput, CreditShareSummary } from "#components/credit-share";
import { useSetSubmittable } from "#components/submit-gate";
import {
  isCreditShareTotalSavable,
  shareBpsToPercentText,
  sharePercentToBps,
  totalCreditShares,
} from "#lib/credit-share";

import type { EpisodeCreatorCredit } from "../episode-edit-types";

export interface CreatorOption {
  id: string;
  name: string;
}
export interface CreatorRoleOption {
  id: string;
  name: string;
}
interface CreditEditorRow extends Omit<EpisodeCreatorCredit, "shareBps"> {
  key: string;
  /** The share box as typed, parsed when the list is summed and posted. */
  shareText: string;
}

const isComplete = (row: CreditEditorRow) =>
  row.creatorId.length > 0 && row.roleId.length > 0;

const EpisodeCreditRow = ({
  creators,
  roles,
  row,
  position,
  onChange,
  onRemove,
}: {
  creators: ComboboxItem[];
  roles: ComboboxItem[];
  row: CreditEditorRow;
  position: number;
  onChange: (row: CreditEditorRow) => void;
  onRemove: () => void;
}) => {
  const creatorId = useId();
  const roleId = useId();
  return (
    <li className="flex flex-wrap items-center gap-2 border border-border bg-background px-2 py-2 sm:flex-nowrap sm:gap-3 sm:px-3">
      <Field className="min-w-40 flex-1">
        <FieldLabel className="sr-only" htmlFor={creatorId}>
          <ClientMessage
            message="admin.series.form.creators_creator_field_label"
            values={{ position: String(position) }}
          />
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={creatorId}
            items={creators}
            onValueChange={(nextCreatorId) =>
              onChange({ ...row, creatorId: nextCreatorId })
            }
            value={row.creatorId}
          >
            <ComboboxInput />
            <ComboboxPopup>
              <ComboboxEmpty>
                <ClientMessage message="admin.series.form.creators_no_match" />
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
      <Field className="min-w-32 flex-1 sm:max-w-48">
        <FieldLabel className="sr-only" htmlFor={roleId}>
          <ClientMessage
            message="admin.series.form.creators_role_field_label"
            values={{ position: String(position) }}
          />
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={roleId}
            items={roles}
            onValueChange={(nextRoleId) =>
              onChange({ ...row, roleId: nextRoleId })
            }
            value={row.roleId}
          >
            <ComboboxInput />
            <ComboboxPopup>
              <ComboboxEmpty>
                <ClientMessage message="admin.series.form.creators_role_no_match" />
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
      <CreditShareInput
        onChange={(shareText) => onChange({ ...row, shareText })}
        position={position}
        value={row.shareText}
      />
      {row.source === CreatorCreditSource.EPISODE ? (
        <span className="text-xs text-muted-foreground">
          <ClientMessage message="admin.series.episodes.credits.episode_only" />
        </span>
      ) : null}
      <Button
        className="shrink-0"
        onClick={onRemove}
        size="icon"
        type="button"
        variant="outline"
      >
        <CloseIcon aria-hidden="true" className="size-4" />
        <span className="sr-only">
          <ClientMessage
            message="admin.series.form.creators_remove"
            values={{ position: String(position) }}
          />
        </span>
      </Button>
    </li>
  );
};

/**
 * The credits the episode is baked with. The rows are this field's own state,
 * and what the form posts is the hidden field below, so a half-written row
 * stays on screen without the rest of the form having to know about it.
 */
export const EpisodeCreatorCreditsField = ({
  creatorRoles,
  creators,
  initialCredits,
}: {
  creatorRoles: CreatorRoleOption[];
  creators: CreatorOption[];
  initialCredits: EpisodeCreatorCredit[];
}) => {
  // The save button belongs to the form around this field, which is told
  // whether the shares as typed can be saved whenever that changes.
  const setSubmittable = useSetSubmittable();
  const [rows, setRows] = useState<CreditEditorRow[]>(() =>
    initialCredits.map(({ shareBps, ...credit }, index) => ({
      ...credit,
      key: String(index),
      shareText: shareBpsToPercentText(shareBps),
    }))
  );
  const nextKey = useRef(initialCredits.length);
  const creatorItems = useMemo<ComboboxItem[]>(
    () =>
      creators.map((creator) => ({
        label: creator.name,
        value: creator.id,
      })),
    [creators]
  );
  const roleItems = useMemo<ComboboxItem[]>(
    () => creatorRoles.map((role) => ({ label: role.name, value: role.id })),
    [creatorRoles]
  );
  const credits = rows.flatMap((row) =>
    isComplete(row)
      ? [
          {
            creatorId: row.creatorId,
            roleId: row.roleId,
            shareBps: sharePercentToBps(row.shareText) ?? 0,
          },
        ]
      : []
  );
  const shareTotal = totalCreditShares(rows.map((row) => row.shareText));
  const add = () => {
    const key = String(nextKey.current);
    nextKey.current += 1;
    setRows((current) => [
      ...current,
      {
        creatorId: "",
        key,
        roleId: creatorRoles.at(0)?.id ?? "",
        shareText: "",
        source: CreatorCreditSource.EPISODE,
      },
    ]);
  };
  /** Writes the rows an edit leaves, and tells the form whether they can be saved. */
  const commitRows = (nextRows: CreditEditorRow[]) => {
    setRows(nextRows);
    setSubmittable(
      isCreditShareTotalSavable(
        totalCreditShares(nextRows.map((row) => row.shareText))
      )
    );
  };
  const changeRow = (next: CreditEditorRow) => {
    commitRows(rows.map((item) => (item.key === next.key ? next : item)));
  };
  const removeRow = (key: string) => {
    commitRows(rows.filter((item) => item.key !== key));
  };
  return (
    <>
      <input
        name="creator_credits"
        type="hidden"
        value={JSON.stringify(credits)}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <ClientMessage message="admin.series.episodes.credits.empty" />
        </p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row, index) => (
            <EpisodeCreditRow
              creators={creatorItems}
              key={row.key}
              onChange={changeRow}
              onRemove={() => removeRow(row.key)}
              position={index + 1}
              roles={roleItems}
              row={row}
            />
          ))}
        </ul>
      )}
      {rows.length > 0 ? <CreditShareSummary total={shareTotal} /> : null}
      <div>
        <Button
          disabled={creatorItems.length === 0 || roleItems.length === 0}
          onClick={add}
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden="true" className="size-4" />
          <ClientMessage message="admin.series.form.creators_add" />
        </Button>
      </div>
    </>
  );
};
