"use client";

import { CreatorCreditSource } from "@publira/api-client/admin/types";
import { CloseIcon, PlusIcon } from "@publira/icons";
import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
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
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState, useId, useMemo, useRef, useState } from "react";

import { ClientMessage } from "#components/client-message";
import { CreditShareInput, CreditShareSummary } from "#components/credit-share";
import {
  isCreditShareTotalSavable,
  shareBpsToPercentText,
  sharePercentToBps,
  totalCreditShares,
} from "#lib/credit-share";
import { useTenantId } from "#lib/use-tenant-id";

import type {
  EpisodeCreatorCredit,
  EpisodeEditActionState,
} from "../episode-edit-types";

interface CreatorOption {
  id: string;
  name: string;
}
interface CreatorRoleOption {
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

export const EpisodeCreatorCreditsForm = ({
  action,
  creatorRoles,
  creators,
  episodeId,
  episodePublicId,
  initialCredits,
  seriesPublicId,
}: {
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  creatorRoles: CreatorRoleOption[];
  creators: CreatorOption[];
  episodeId: string;
  episodePublicId: string;
  initialCredits: EpisodeCreatorCredit[];
  seriesPublicId: string;
}) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
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
  const changeRow = (next: CreditEditorRow) => {
    setRows((current) =>
      current.map((item) => (item.key === next.key ? next : item))
    );
  };
  const removeRow = (key: string) => {
    setRows((current) => current.filter((item) => item.key !== key));
  };
  return (
    <section className="grid gap-3 border border-border p-4">
      <h2 className="text-sm font-medium">
        <ClientMessage message="admin.series.episodes.credits.title" />
      </h2>
      <p className="text-xs text-muted-foreground">
        <ClientMessage message="admin.series.episodes.credits.description" />
      </p>
      <p className="text-xs text-muted-foreground">
        <ClientMessage message="admin.series.form.creators_share_description" />
      </p>
      <form action={formAction} className="grid gap-3">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_id" type="hidden" value={episodeId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />
        <input
          name="creator_credits"
          type="hidden"
          value={JSON.stringify(credits)}
        />
        <Fieldset className="grid gap-3" disabled={isPending}>
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
        </Fieldset>
        {state?.mode === "credits" ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}
        <div className="flex justify-end">
          <Button
            disabled={isPending || !isCreditShareTotalSavable(shareTotal)}
            type="submit"
          >
            <ActionFormIdle>
              <ClientMessage message="admin.series.episodes.credits.save" />
            </ActionFormIdle>
            <ActionFormPending>
              <ClientMessage message="admin.series.episodes.credits.saving" />
            </ActionFormPending>
          </Button>
        </div>
      </form>
    </section>
  );
};
