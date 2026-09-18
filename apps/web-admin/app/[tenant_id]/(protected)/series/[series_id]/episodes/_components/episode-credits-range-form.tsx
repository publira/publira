"use client";

import { toIntlLocale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { DialogClose, DialogFooter } from "@publira/ui-components/dialog";
import {
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import { formatShareBps, sharePercentToBps } from "#lib/credit-share";
import type { AdminMessageAccessor } from "#lib/messages";
import { useTenantId } from "#lib/use-tenant-id";

import {
  MAX_BULK_EPISODE_CREDIT_EPISODES,
  episodesSelectedInReadingOrder,
} from "../_lib/credit-range";
import type {
  BulkEditEpisodeCreditsActionState,
  CreditPickerOption,
  EpisodeCreditRangeOption,
} from "../episode-types";
import {
  EpisodeCreditsRangeEditor,
  OPERATIONS,
} from "./episode-credits-range-editor";
import type {
  CreditOperation,
  CreditPair,
} from "./episode-credits-range-editor";
import { EpisodeCreditsRangeResult } from "./episode-credits-range-result";
import { useEpisodeCreditsSelection } from "./episode-credits-selection";

const isCreditOperation = (value: string): value is CreditOperation =>
  OPERATIONS.some((operation) => operation === value);

const emptyPair = (creatorRoles: CreditPickerOption[]): CreditPair => ({
  creatorPublicId: "",
  rolePublicId: creatorRoles.at(0)?.publicId ?? "",
});

const isCompletePair = (pair: CreditPair): boolean =>
  pair.creatorPublicId.length > 0 && pair.rolePublicId.length > 0;

const optionName = (
  options: readonly { name: string; publicId: string }[],
  publicId: string
): string =>
  options.find((option) => option.publicId === publicId)?.name ?? publicId;

const isReplaceSame = (
  operation: CreditOperation,
  from: CreditPair,
  to: CreditPair
): boolean =>
  operation === "replace" &&
  from.creatorPublicId === to.creatorPublicId &&
  from.rolePublicId === to.rolePublicId &&
  isCompletePair(from);

/**
 * The share a set-share would write, or `undefined` while the box does not
 * hold one. An empty box is not 0 here: it names no share to set.
 */
const toSetShareBps = (shareText: string): number | undefined =>
  shareText.trim() === "" ? undefined : sharePercentToBps(shareText);

const isCreditComplete = (
  operation: CreditOperation,
  credit: CreditPair,
  from: CreditPair,
  to: CreditPair,
  shareText: string
): boolean => {
  if (operation === "replace") {
    return isCompletePair(from) && isCompletePair(to);
  }
  if (operation === "set_share") {
    return isCompletePair(credit) && toSetShareBps(shareText) !== undefined;
  }
  return isCompletePair(credit);
};

const canApplyCreditSelection = (input: {
  creditComplete: boolean;
  hasCreators: boolean;
  hasRoles: boolean;
  isEpisodePending: boolean;
  isPending: boolean;
  replaceSame: boolean;
  selectedCount: number;
  selectionTooMany: boolean;
}): boolean => {
  if (input.isPending || input.isEpisodePending || input.replaceSame) {
    return false;
  }
  if (!(input.creditComplete && input.hasCreators && input.hasRoles)) {
    return false;
  }
  return input.selectedCount > 0 && !input.selectionTooMany;
};

const creditSelectionPreview = (input: {
  credit: CreditPair;
  creditComplete: boolean;
  creatorRoles: CreditPickerOption[];
  creators: CreditPickerOption[];
  from: CreditPair;
  intlLocale: string;
  operation: CreditOperation;
  replaceSame: boolean;
  selectedCount: number;
  selectionTooMany: boolean;
  shareText: string;
  t: AdminMessageAccessor;
  to: CreditPair;
}): string => {
  if (
    !(input.creditComplete && input.selectedCount > 0) ||
    input.selectionTooMany ||
    input.replaceSame
  ) {
    return "";
  }
  const count = String(input.selectedCount);
  if (input.operation === "replace") {
    return input.t("admin.series.episodes.credits.preview_replace", {
      count,
      from_creator: optionName(input.creators, input.from.creatorPublicId),
      from_role: optionName(input.creatorRoles, input.from.rolePublicId),
      to_creator: optionName(input.creators, input.to.creatorPublicId),
      to_role: optionName(input.creatorRoles, input.to.rolePublicId),
    });
  }
  if (input.operation === "set_share") {
    return input.t("admin.series.episodes.credits.preview_set_share", {
      count,
      creator: optionName(input.creators, input.credit.creatorPublicId),
      role: optionName(input.creatorRoles, input.credit.rolePublicId),
      share: formatShareBps(
        toSetShareBps(input.shareText) ?? 0,
        input.intlLocale
      ),
    });
  }
  const previewKey =
    input.operation === "add"
      ? "admin.series.episodes.credits.preview_add"
      : "admin.series.episodes.credits.preview_remove";
  return input.t(previewKey, {
    count,
    creator: optionName(input.creators, input.credit.creatorPublicId),
    role: optionName(input.creatorRoles, input.credit.rolePublicId),
  });
};

export interface EpisodeCreditsRangeFormProps {
  action: (
    prevState: BulkEditEpisodeCreditsActionState,
    formData: FormData
  ) => Promise<BulkEditEpisodeCreditsActionState>;
  creatorRoles: CreditPickerOption[];
  creatorRolesErrorMessage?: string;
  creators: CreditPickerOption[];
  creatorsErrorMessage?: string;
  episodes: EpisodeCreditRangeOption[];
  episodesErrorMessage?: string;
  isEpisodePending: boolean;
  onRetryEpisodes: () => void;
  seriesPublicId: string;
}

export const EpisodeCreditsRangeForm = ({
  action,
  creatorRoles,
  creatorRolesErrorMessage,
  creators,
  creatorsErrorMessage,
  episodes,
  episodesErrorMessage,
  isEpisodePending,
  onRetryEpisodes,
  seriesPublicId,
}: EpisodeCreditsRangeFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const { clear, selectedIds, selectMany, toggle } =
    useEpisodeCreditsSelection();
  const runAction = useCallback(
    async (
      prevState: BulkEditEpisodeCreditsActionState,
      formData: FormData
    ): Promise<BulkEditEpisodeCreditsActionState> => {
      const next = await action(prevState, formData);
      if (next?.ok) {
        clear();
      }
      return next;
    },
    [action, clear]
  );
  const [state, formAction, isPending] = useActionState(runAction, null);
  const [operation, setOperation] = useState<CreditOperation>("add");
  const [credit, setCredit] = useState(() => emptyPair(creatorRoles));
  const [from, setFrom] = useState(() => emptyPair(creatorRoles));
  const [to, setTo] = useState(() => emptyPair(creatorRoles));
  const [shareText, setShareText] = useState("");

  const creatorItems = useMemo<ComboboxItem[]>(
    () =>
      creators
        .map((creator) => ({ label: creator.name, value: creator.publicId }))
        .toSorted((left, right) =>
          left.label.localeCompare(right.label, toIntlLocale(locale))
        ),
    [creators, locale]
  );
  const roleItems = useMemo<ComboboxItem[]>(
    () =>
      creatorRoles.map((role) => ({
        label: role.name,
        value: role.publicId,
      })),
    [creatorRoles]
  );
  const selected = episodesSelectedInReadingOrder(episodes, [...selectedIds]);
  const selectionTooMany = selected.length > MAX_BULK_EPISODE_CREDIT_EPISODES;
  const replaceSame = isReplaceSame(operation, from, to);
  const creditComplete = isCreditComplete(
    operation,
    credit,
    from,
    to,
    shareText
  );
  const canSubmit = canApplyCreditSelection({
    creditComplete,
    hasCreators: creatorItems.length > 0,
    hasRoles: roleItems.length > 0,
    isEpisodePending,
    isPending,
    replaceSame,
    selectedCount: selected.length,
    selectionTooMany,
  });
  const preview = creditSelectionPreview({
    creatorRoles,
    creators,
    credit,
    creditComplete,
    from,
    intlLocale: toIntlLocale(locale),
    operation,
    replaceSame,
    selectedCount: selected.length,
    selectionTooMany,
    shareText,
    t,
    to,
  });

  const handleOperationChange = useCallback((next: string) => {
    if (isCreditOperation(next)) {
      setOperation(next);
    }
  }, []);

  if (state?.ok) {
    return (
      <div className="grid gap-5">
        <EpisodeCreditsRangeResult episodes={episodes} result={state} />
        <DialogFooter className="sticky bottom-0 z-10 border-t border-border bg-card pt-4">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                {t("admin.series.episodes.credits.close")}
              </Button>
            }
          />
        </DialogFooter>
      </div>
    );
  }

  return (
    <EpisodeCreditsRangeEditor
      canSubmit={canSubmit}
      credit={credit}
      creatorItems={creatorItems}
      creatorRolesEmpty={roleItems.length === 0}
      creatorRolesErrorMessage={creatorRolesErrorMessage}
      creatorsEmpty={creatorItems.length === 0}
      creatorsErrorMessage={creatorsErrorMessage}
      episodes={episodes}
      episodesEmpty={
        !isEpisodePending && !episodesErrorMessage && episodes.length === 0
      }
      episodesErrorMessage={episodesErrorMessage}
      errorMessage={state && !state.ok ? state.message : ""}
      formAction={formAction}
      from={from}
      hidden={{
        credit,
        episodePublicIds: JSON.stringify(
          selected.map((episode) => episode.publicId)
        ),
        from,
        operation,
        seriesPublicId,
        share: shareText,
        tenantId,
        to,
      }}
      isEpisodePending={isEpisodePending}
      isPending={isPending}
      onClearSelection={clear}
      onCreditChange={setCredit}
      onFromChange={setFrom}
      onOperationChange={handleOperationChange}
      onRetryEpisodes={onRetryEpisodes}
      onSelectMany={selectMany}
      onShareChange={setShareText}
      onToChange={setTo}
      onToggle={toggle}
      operation={operation}
      preview={preview}
      replaceSame={replaceSame}
      roleItems={roleItems}
      selectedIds={selectedIds}
      selectedCount={selected.length}
      selectionTooMany={selectionTooMany}
      shareText={shareText}
      to={to}
    />
  );
};
