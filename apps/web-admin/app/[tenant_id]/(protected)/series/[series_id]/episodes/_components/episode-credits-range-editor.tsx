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
import type { ReactNode } from "react";
import { useId, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { sharePercentToBps } from "#lib/credit-share";

import { MAX_BULK_EPISODE_CREDIT_EPISODES } from "../_lib/credit-range";
import type { EpisodeCreditRangeOption } from "../episode-types";
import { selectionCheckboxProps } from "./episode-selection";

export const OPERATIONS = ["add", "replace", "remove", "set_share"] as const;

export type CreditOperation = (typeof OPERATIONS)[number];

export interface CreditPair {
  creatorId: string;
  roleId: string;
}

interface CreditPairFieldsProps {
  creatorItems: ComboboxItem[];
  onCreatorChange: (nextCreatorId: string) => void;
  onRoleChange: (nextRoleId: string) => void;
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

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel>{t("admin.series.episodes.credits.creator")}</FieldLabel>
        <FieldContent>
          <Combobox
            items={creatorItems}
            onValueChange={onCreatorChange}
            value={pair.creatorId}
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
        <FieldLabel>{t("admin.series.episodes.credits.role")}</FieldLabel>
        <FieldContent>
          <Combobox
            items={roleItems}
            onValueChange={onRoleChange}
            value={pair.roleId}
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
  const invalid =
    shareText.trim().length > 0 && sharePercentToBps(shareText) === undefined;

  return (
    <Field className="sm:max-w-40">
      <FieldLabel>{t("admin.series.episodes.credits.share")}</FieldLabel>
      <FieldContent>
        <Input
          aria-invalid={invalid}
          className="text-right tabular-nums"
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
          onCreatorChange={(creatorId) =>
            onCreditChange({ ...credit, creatorId })
          }
          onRoleChange={(roleId) => onCreditChange({ ...credit, roleId })}
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
        onCreatorChange={(creatorId) =>
          onCreditChange({ ...credit, creatorId })
        }
        onRoleChange={(roleId) => onCreditChange({ ...credit, roleId })}
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
          onCreatorChange={(creatorId) => onFromChange({ ...from, creatorId })}
          onRoleChange={(roleId) => onFromChange({ ...from, roleId })}
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
          onCreatorChange={(creatorId) => onToChange({ ...to, creatorId })}
          onRoleChange={(roleId) => onToChange({ ...to, roleId })}
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
  onSelectMany: (ids: readonly string[], selected: boolean) => void;
  onToggle: (id: string, selected: boolean) => void;
  selectedCount: number;
  selectedIds: ReadonlySet<string>;
  selectionTooMany: boolean;
}) => {
  const t = useClientMessages();
  const selectVisibleId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const visibleEpisodes = episodes.filter((episode) =>
    episodeMatchesQuery(episode, query.trim())
  );
  const visibleIds = visibleEpisodes.map((episode) => episode.id);
  const selectedVisibleCount = visibleIds.filter((id) =>
    selectedIds.has(id)
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
        <FieldLabel>
          {t("admin.series.episodes.credits.selection_search")}
        </FieldLabel>
        <FieldContent>
          <Input
            disabled={listDisabled}
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
              const rowId = `${listId}-${episode.id}`;
              return (
                <label
                  className="flex items-center gap-2 text-sm"
                  htmlFor={rowId}
                  key={episode.id}
                >
                  <Checkbox
                    checked={selectedIds.has(episode.id)}
                    disabled={listDisabled}
                    id={rowId}
                    onCheckedChange={(checked) => {
                      onToggle(episode.id, checked);
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
                count: selectedCount,
              })}
        </p>
      ) : null}
    </fieldset>
  );
};

/**
 * The part of the dialog that scrolls, between its header and its footer.
 * The footer is not inside it, so a control focused here is scrolled into
 * view above the footer whatever height the footer's buttons stack to. The
 * negative inline margin and the padding of the same size reach the popup's
 * edges, so a control's focus ring is not cut off at the sides, and the
 * scroll padding keeps the ring of a control scrolled into view clear of the
 * top and the bottom edge.
 */
export const EpisodeCreditsRangeBody = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="-mx-5 mt-4 grid min-h-0 scroll-py-4 gap-5 overflow-y-auto border-y border-border px-5 py-4">
    {children}
  </div>
);

/**
 * The dialog's footer, under `EpisodeCreditsRangeBody` rather than over it.
 * Its parent is a column the popup's height bounds, and `shrink-0` leaves
 * all of the shrinking to the body.
 */
export const EpisodeCreditsRangeFooter = ({
  children,
}: {
  children: ReactNode;
}) => <DialogFooter className="mt-0 shrink-0 pt-4">{children}</DialogFooter>;

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
    episodeIds: string;
    from: CreditPair;
    operation: CreditOperation;
    seriesId: string;
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
  onSelectMany: (ids: readonly string[], selected: boolean) => void;
  onShareChange: (next: string) => void;
  onToChange: (next: CreditPair) => void;
  onToggle: (id: string, selected: boolean) => void;
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

  return (
    <form action={formAction} className="flex min-h-0 flex-col">
      <input name="tenant_id" type="hidden" value={hidden.tenantId} />
      <input name="series_id" type="hidden" value={hidden.seriesId} />
      <input name="operation" type="hidden" value={hidden.operation} />
      <input name="episode_ids" type="hidden" value={hidden.episodeIds} />
      <input name="creator_id" type="hidden" value={hidden.credit.creatorId} />
      <input name="role_id" type="hidden" value={hidden.credit.roleId} />
      <input
        name="from_creator_id"
        type="hidden"
        value={hidden.from.creatorId}
      />
      <input name="from_role_id" type="hidden" value={hidden.from.roleId} />
      <input name="to_creator_id" type="hidden" value={hidden.to.creatorId} />
      <input name="to_role_id" type="hidden" value={hidden.to.roleId} />
      <input name="share" type="hidden" value={hidden.share} />

      <EpisodeCreditsRangeBody>
        <Fieldset className="grid gap-5" disabled={isPending}>
          <Field>
            <FieldLabel>
              {t("admin.series.episodes.credits.operation")}
            </FieldLabel>
            <FieldContent>
              <RadioGroup
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
                    label: t(
                      "admin.series.episodes.credits.operation_set_share"
                    ),
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
          <FormMessage variant="destructive">
            {creatorsErrorMessage}
          </FormMessage>
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
      </EpisodeCreditsRangeBody>

      <EpisodeCreditsRangeFooter>
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
      </EpisodeCreditsRangeFooter>
    </form>
  );
};
