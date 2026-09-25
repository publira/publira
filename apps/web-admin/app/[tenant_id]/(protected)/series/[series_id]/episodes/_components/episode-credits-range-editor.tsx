"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import { DialogClose, DialogFooter } from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useId, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { sharePercentToBps } from "#lib/credit-share";

import { MAX_BULK_EPISODE_CREDIT_EPISODES } from "../_lib/credit-range";
import type { EpisodeCreditRangeOption } from "../episode-types";
import { selectionCheckboxProps } from "./episode-credits-selection";

export const OPERATIONS = ["add", "replace", "remove", "set_share"] as const;

export type CreditOperation = (typeof OPERATIONS)[number];

export interface CreditPair {
  creatorPublicId: string;
  rolePublicId: string;
}

interface CreditPairFieldsProps {
  creatorItems: ComboboxItem[];
  onCreatorChange: (nextCreatorPublicId: string) => void;
  onRoleChange: (nextRolePublicId: string) => void;
  pair: CreditPair;
  roleItems: ComboboxItem[];
}

const CreditPairFields = ({
  creatorItems,
  onCreatorChange,
  onRoleChange,
  pair,
  roleItems,
}: CreditPairFieldsProps) => {
  const t = useClientMessages();
  const creatorId = useId();
  const roleId = useId();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={creatorId}>
          {t("admin.series.episodes.credits.creator")}
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={creatorId}
            items={creatorItems}
            onValueChange={onCreatorChange}
            value={pair.creatorPublicId}
          >
            <ComboboxInput
              placeholder={t("admin.series.episodes.credits.creator_search")}
            />
            <ComboboxPopup>
              <ComboboxEmpty>
                {t("admin.series.episodes.credits.creator_no_match")}
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor={roleId}>
          {t("admin.series.episodes.credits.role")}
        </FieldLabel>
        <FieldContent>
          <Combobox
            id={roleId}
            items={roleItems}
            onValueChange={onRoleChange}
            value={pair.rolePublicId}
          >
            <ComboboxInput
              placeholder={t("admin.series.episodes.credits.role_search")}
            />
            <ComboboxPopup>
              <ComboboxEmpty>
                {t("admin.series.episodes.credits.role_no_match")}
              </ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>
    </div>
  );
};

/** The share a set-share writes, typed as a percentage. */
const ShareField = ({
  onShareChange,
  shareText,
}: {
  onShareChange: (next: string) => void;
  shareText: string;
}) => {
  const t = useClientMessages();
  const shareId = useId();
  const invalid =
    shareText.trim().length > 0 && sharePercentToBps(shareText) === undefined;

  return (
    <Field className="sm:max-w-40">
      <FieldLabel htmlFor={shareId}>
        {t("admin.series.episodes.credits.share")}
      </FieldLabel>
      <FieldContent>
        <Input
          aria-invalid={invalid}
          className="text-right tabular-nums"
          id={shareId}
          inputMode="decimal"
          onChange={(event) => onShareChange(event.currentTarget.value)}
          value={shareText}
        />
      </FieldContent>
      {invalid ? (
        <FormMessage variant="destructive">
          {t("admin.series.episodes.credits.validation.share_invalid")}
        </FormMessage>
      ) : null}
    </Field>
  );
};

const CreditTargetFields = ({
  credit,
  creatorItems,
  from,
  onCreditChange,
  onFromChange,
  onShareChange,
  onToChange,
  operation,
  roleItems,
  shareText,
  to,
}: {
  credit: CreditPair;
  creatorItems: ComboboxItem[];
  from: CreditPair;
  onCreditChange: (next: CreditPair) => void;
  onFromChange: (next: CreditPair) => void;
  onShareChange: (next: string) => void;
  onToChange: (next: CreditPair) => void;
  operation: CreditOperation;
  roleItems: ComboboxItem[];
  shareText: string;
  to: CreditPair;
}) => {
  const t = useClientMessages();

  if (operation === "set_share") {
    return (
      <div className="grid gap-3">
        <CreditPairFields
          creatorItems={creatorItems}
          onCreatorChange={(creatorPublicId) =>
            onCreditChange({ ...credit, creatorPublicId })
          }
          onRoleChange={(rolePublicId) =>
            onCreditChange({ ...credit, rolePublicId })
          }
          pair={credit}
          roleItems={roleItems}
        />
        <ShareField onShareChange={onShareChange} shareText={shareText} />
      </div>
    );
  }

  if (operation !== "replace") {
    return (
      <CreditPairFields
        creatorItems={creatorItems}
        onCreatorChange={(creatorPublicId) =>
          onCreditChange({ ...credit, creatorPublicId })
        }
        onRoleChange={(rolePublicId) =>
          onCreditChange({ ...credit, rolePublicId })
        }
        pair={credit}
        roleItems={roleItems}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium text-foreground">
          {t("admin.series.episodes.credits.from_legend")}
        </legend>
        <CreditPairFields
          creatorItems={creatorItems}
          onCreatorChange={(creatorPublicId) =>
            onFromChange({ ...from, creatorPublicId })
          }
          onRoleChange={(rolePublicId) =>
            onFromChange({ ...from, rolePublicId })
          }
          pair={from}
          roleItems={roleItems}
        />
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium text-foreground">
          {t("admin.series.episodes.credits.to_legend")}
        </legend>
        <CreditPairFields
          creatorItems={creatorItems}
          onCreatorChange={(creatorPublicId) =>
            onToChange({ ...to, creatorPublicId })
          }
          onRoleChange={(rolePublicId) => onToChange({ ...to, rolePublicId })}
          pair={to}
          roleItems={roleItems}
        />
      </fieldset>
    </div>
  );
};

const episodeMatchesQuery = (
  episode: EpisodeCreditRangeOption,
  query: string
): boolean => {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return (
    episode.title.toLowerCase().includes(needle) ||
    episode.publicId.toLowerCase().includes(needle)
  );
};

const EpisodeSelectionFields = ({
  episodes,
  episodesEmpty,
  episodesErrorMessage,
  isEpisodePending,
  onClearSelection,
  onRetryEpisodes,
  onSelectMany,
  onToggle,
  selectedCount,
  selectedIds,
  selectionTooMany,
}: {
  episodes: EpisodeCreditRangeOption[];
  episodesEmpty: boolean;
  episodesErrorMessage?: string;
  isEpisodePending: boolean;
  onClearSelection: () => void;
  onRetryEpisodes: () => void;
  onSelectMany: (publicIds: readonly string[], selected: boolean) => void;
  onToggle: (publicId: string, selected: boolean) => void;
  selectedCount: number;
  selectedIds: ReadonlySet<string>;
  selectionTooMany: boolean;
}) => {
  const t = useClientMessages();
  const searchId = useId();
  const selectVisibleId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const visibleEpisodes = episodes.filter((episode) =>
    episodeMatchesQuery(episode, query.trim())
  );
  const visibleIds = visibleEpisodes.map((episode) => episode.publicId);
  const selectedVisibleCount = visibleIds.filter((publicId) =>
    selectedIds.has(publicId)
  ).length;
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const listDisabled = isEpisodePending || episodes.length === 0;

  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium text-foreground">
        {t("admin.series.episodes.credits.selection")}
      </legend>
      <Field>
        <FieldLabel htmlFor={searchId}>
          {t("admin.series.episodes.credits.selection_search")}
        </FieldLabel>
        <FieldContent>
          <Input
            disabled={listDisabled}
            id={searchId}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("admin.series.episodes.credits.selection_search")}
            type="search"
            value={query}
          />
        </FieldContent>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            {...selectionCheckboxProps(allVisibleSelected, someVisibleSelected)}
            disabled={listDisabled || visibleIds.length === 0}
            id={selectVisibleId}
            onCheckedChange={(checked) => {
              onSelectMany(visibleIds, checked);
            }}
          />
          <label
            className="text-xs text-muted-foreground"
            htmlFor={selectVisibleId}
          >
            {t("admin.series.episodes.credits.selection_select_visible")}
          </label>
        </div>
        <Button
          disabled={selectedCount === 0}
          onClick={onClearSelection}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("admin.series.episodes.credits.selection_clear")}
        </Button>
      </div>
      {isEpisodePending ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.series.episodes.credits.episodes_loading")}
        </p>
      ) : null}
      {episodesErrorMessage ? (
        <div className="grid gap-2">
          <FormMessage variant="destructive">
            {episodesErrorMessage}
          </FormMessage>
          <div>
            <Button onClick={onRetryEpisodes} type="button" variant="outline">
              {t("admin.series.episodes.credits.episodes_retry")}
            </Button>
          </div>
        </div>
      ) : null}
      {episodesEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.series.episodes.credits.episodes_empty")}
        </p>
      ) : null}
      {!isEpisodePending && !episodesEmpty && visibleEpisodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.series.episodes.credits.selection_no_match")}
        </p>
      ) : null}
      {visibleEpisodes.length > 0 ? (
        <div className="max-h-72 overflow-y-auto border border-border p-3">
          <div className="grid gap-2">
            {visibleEpisodes.map((episode) => {
              const rowId = `${listId}-${episode.publicId}`;
              return (
                <label
                  className="flex items-center gap-2 text-sm"
                  htmlFor={rowId}
                  key={episode.publicId}
                >
                  <Checkbox
                    checked={selectedIds.has(episode.publicId)}
                    disabled={listDisabled}
                    id={rowId}
                    onCheckedChange={(checked) => {
                      onToggle(episode.publicId, checked);
                    }}
                  />
                  <span>
                    {t("admin.series.episodes.credits.episode_option", {
                      id: episode.publicId,
                      title: episode.title,
                    })}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
      {selectedCount > 0 ? (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {selectionTooMany
            ? t("admin.series.episodes.credits.selection_too_many", {
                count: String(MAX_BULK_EPISODE_CREDIT_EPISODES),
              })
            : t("admin.series.episodes.credits.selection_count", {
                count: String(selectedCount),
              })}
        </p>
      ) : null}
    </fieldset>
  );
};

export interface EpisodeCreditsRangeEditorProps {
  canSubmit: boolean;
  credit: CreditPair;
  creatorItems: ComboboxItem[];
  creatorRolesEmpty: boolean;
  creatorRolesErrorMessage?: string;
  creatorsEmpty: boolean;
  creatorsErrorMessage?: string;
  episodes: EpisodeCreditRangeOption[];
  episodesEmpty: boolean;
  episodesErrorMessage?: string;
  errorMessage?: string;
  formAction: (formData: FormData) => void;
  from: CreditPair;
  hidden: {
    credit: CreditPair;
    episodePublicIds: string;
    from: CreditPair;
    operation: CreditOperation;
    seriesPublicId: string;
    share: string;
    tenantId: string;
    to: CreditPair;
  };
  isEpisodePending: boolean;
  isPending: boolean;
  onClearSelection: () => void;
  onCreditChange: (next: CreditPair) => void;
  onFromChange: (next: CreditPair) => void;
  onOperationChange: (next: string) => void;
  onRetryEpisodes: () => void;
  onSelectMany: (publicIds: readonly string[], selected: boolean) => void;
  onShareChange: (next: string) => void;
  onToChange: (next: CreditPair) => void;
  onToggle: (publicId: string, selected: boolean) => void;
  operation: CreditOperation;
  preview?: string;
  replaceSame: boolean;
  roleItems: ComboboxItem[];
  selectedCount: number;
  selectedIds: ReadonlySet<string>;
  selectionTooMany: boolean;
  shareText: string;
  to: CreditPair;
}

export const EpisodeCreditsRangeEditor = ({
  canSubmit,
  credit,
  creatorItems,
  creatorRolesEmpty,
  creatorRolesErrorMessage,
  creatorsEmpty,
  creatorsErrorMessage,
  episodes,
  episodesEmpty,
  episodesErrorMessage,
  errorMessage,
  formAction,
  from,
  hidden,
  isEpisodePending,
  isPending,
  onClearSelection,
  onCreditChange,
  onFromChange,
  onOperationChange,
  onRetryEpisodes,
  onSelectMany,
  onShareChange,
  onToChange,
  onToggle,
  operation,
  preview,
  replaceSame,
  roleItems,
  selectedCount,
  selectedIds,
  selectionTooMany,
  shareText,
  to,
}: EpisodeCreditsRangeEditorProps) => {
  const t = useClientMessages();
  const operationId = useId();

  return (
    <form action={formAction} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={hidden.tenantId} />
      <input
        name="series_public_id"
        type="hidden"
        value={hidden.seriesPublicId}
      />
      <input name="operation" type="hidden" value={hidden.operation} />
      <input
        name="episode_public_ids"
        type="hidden"
        value={hidden.episodePublicIds}
      />
      <input
        name="creator_public_id"
        type="hidden"
        value={hidden.credit.creatorPublicId}
      />
      <input
        name="role_public_id"
        type="hidden"
        value={hidden.credit.rolePublicId}
      />
      <input
        name="from_creator_public_id"
        type="hidden"
        value={hidden.from.creatorPublicId}
      />
      <input
        name="from_role_public_id"
        type="hidden"
        value={hidden.from.rolePublicId}
      />
      <input
        name="to_creator_public_id"
        type="hidden"
        value={hidden.to.creatorPublicId}
      />
      <input
        name="to_role_public_id"
        type="hidden"
        value={hidden.to.rolePublicId}
      />
      <input name="share" type="hidden" value={hidden.share} />

      <Fieldset className="grid gap-5" disabled={isPending}>
        <Field>
          <FieldLabel htmlFor={operationId}>
            {t("admin.series.episodes.credits.operation")}
          </FieldLabel>
          <FieldContent>
            <RadioGroup
              id={operationId}
              items={[
                {
                  description: t(
                    "admin.series.episodes.credits.operation_add_description"
                  ),
                  label: t("admin.series.episodes.credits.operation_add"),
                  value: "add",
                },
                {
                  description: t(
                    "admin.series.episodes.credits.operation_replace_description"
                  ),
                  label: t("admin.series.episodes.credits.operation_replace"),
                  value: "replace",
                },
                {
                  description: t(
                    "admin.series.episodes.credits.operation_remove_description"
                  ),
                  label: t("admin.series.episodes.credits.operation_remove"),
                  value: "remove",
                },
                {
                  description: t(
                    "admin.series.episodes.credits.operation_set_share_description"
                  ),
                  label: t("admin.series.episodes.credits.operation_set_share"),
                  value: "set_share",
                },
              ]}
              onValueChange={onOperationChange}
              value={operation}
            />
          </FieldContent>
        </Field>

        <CreditTargetFields
          credit={credit}
          creatorItems={creatorItems}
          from={from}
          onCreditChange={onCreditChange}
          onFromChange={onFromChange}
          onShareChange={onShareChange}
          onToChange={onToChange}
          operation={operation}
          roleItems={roleItems}
          shareText={shareText}
          to={to}
        />

        <EpisodeSelectionFields
          episodes={episodes}
          episodesEmpty={episodesEmpty}
          episodesErrorMessage={episodesErrorMessage}
          isEpisodePending={isEpisodePending}
          onClearSelection={onClearSelection}
          onRetryEpisodes={onRetryEpisodes}
          onSelectMany={onSelectMany}
          onToggle={onToggle}
          selectedCount={selectedCount}
          selectedIds={selectedIds}
          selectionTooMany={selectionTooMany}
        />
      </Fieldset>

      {creatorsErrorMessage ? (
        <FormMessage variant="destructive">{creatorsErrorMessage}</FormMessage>
      ) : null}
      {creatorRolesErrorMessage ? (
        <FormMessage variant="destructive">
          {creatorRolesErrorMessage}
        </FormMessage>
      ) : null}
      {creatorsEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.series.form.creators_empty")}
        </p>
      ) : null}
      {creatorRolesEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.series.form.creator_roles_empty")}
        </p>
      ) : null}
      {replaceSame ? (
        <FormMessage variant="destructive">
          {t("admin.series.episodes.credits.validation.replace_same")}
        </FormMessage>
      ) : null}
      {preview ? <p className="text-sm text-foreground">{preview}</p> : null}
      {errorMessage ? (
        <FormMessage variant="destructive">{errorMessage}</FormMessage>
      ) : null}

      <DialogFooter className="sticky bottom-0 z-10 border-t border-border bg-card pt-4">
        <DialogClose
          render={
            <Button type="button" variant="outline">
              {t("admin.common.cancel")}
            </Button>
          }
        />
        <Button disabled={!canSubmit} type="submit">
          <ActionFormIdle>
            <ClientMessage message="admin.series.episodes.credits.apply" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.series.episodes.credits.applying" />
          </ActionFormPending>
        </Button>
      </DialogFooter>
    </form>
  );
};
