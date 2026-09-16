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

import {
  AdminLocaleContext,
  useAdminMessages,
} from "#components/admin-locale-context";
import type { AdminMessageAccessor } from "#lib/messages";
import { useTenantId } from "#lib/use-tenant-id";

import {
  MAX_BULK_EPISODE_CREDIT_EPISODES,
  episodesInInclusiveRange,
} from "../_lib/credit-range";
import type {
  BulkEditEpisodeCreditsActionState,
  CreditPickerOption,
  EpisodeCreditRangeOption,
} from "../episode-types";
import { EpisodeCreditsRangeEditor } from "./episode-credits-range-editor";
import type {
  CreditOperation,
  CreditPair,
} from "./episode-credits-range-editor";
import { EpisodeCreditsRangeResult } from "./episode-credits-range-result";

const isCreditOperation = (value: string): value is CreditOperation =>
  value === "add" || value === "replace" || value === "remove";

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

const optionTitle = (
  options: readonly EpisodeCreditRangeOption[],
  publicId: string
): string =>
  options.find((option) => option.publicId === publicId)?.title ?? publicId;

const isReplaceSame = (
  operation: CreditOperation,
  from: CreditPair,
  to: CreditPair
): boolean =>
  operation === "replace" &&
  from.creatorPublicId === to.creatorPublicId &&
  from.rolePublicId === to.rolePublicId &&
  isCompletePair(from);

const isCreditComplete = (
  operation: CreditOperation,
  credit: CreditPair,
  from: CreditPair,
  to: CreditPair
): boolean => {
  if (operation === "replace") {
    return isCompletePair(from) && isCompletePair(to);
  }
  return isCompletePair(credit);
};

const canApplyCreditRange = (input: {
  creditComplete: boolean;
  hasCreators: boolean;
  hasRoles: boolean;
  isEpisodePending: boolean;
  isPending: boolean;
  rangeCount: number;
  rangeTooMany: boolean;
  replaceSame: boolean;
}): boolean => {
  if (input.isPending || input.isEpisodePending || input.replaceSame) {
    return false;
  }
  if (!(input.creditComplete && input.hasCreators && input.hasRoles)) {
    return false;
  }
  return input.rangeCount > 0 && !input.rangeTooMany;
};

const creditRangePreview = (input: {
  credit: CreditPair;
  creditComplete: boolean;
  creatorRoles: CreditPickerOption[];
  creators: CreditPickerOption[];
  from: CreditPair;
  operation: CreditOperation;
  range: EpisodeCreditRangeOption[];
  rangeTooMany: boolean;
  replaceSame: boolean;
  t: AdminMessageAccessor;
  to: CreditPair;
}): string => {
  if (
    !(input.creditComplete && input.range.length > 0) ||
    input.rangeTooMany ||
    input.replaceSame
  ) {
    return "";
  }
  const count = String(input.range.length);
  const first = optionTitle(input.range, input.range.at(0)?.publicId ?? "");
  const last = optionTitle(input.range, input.range.at(-1)?.publicId ?? "");
  if (input.operation === "replace") {
    return input.t("admin.series.episodes.credits.preview_replace", {
      count,
      first,
      from_creator: optionName(input.creators, input.from.creatorPublicId),
      from_role: optionName(input.creatorRoles, input.from.rolePublicId),
      last,
      to_creator: optionName(input.creators, input.to.creatorPublicId),
      to_role: optionName(input.creatorRoles, input.to.rolePublicId),
    });
  }
  const previewKey =
    input.operation === "add"
      ? "admin.series.episodes.credits.preview_add"
      : "admin.series.episodes.credits.preview_remove";
  return input.t(previewKey, {
    count,
    creator: optionName(input.creators, input.credit.creatorPublicId),
    first,
    last,
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
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [operation, setOperation] = useState<CreditOperation>("add");
  const [credit, setCredit] = useState(() => emptyPair(creatorRoles));
  const [from, setFrom] = useState(() => emptyPair(creatorRoles));
  const [to, setTo] = useState(() => emptyPair(creatorRoles));
  const [firstEpisodePublicId, setFirstEpisodePublicId] = useState("");
  const [lastEpisodePublicId, setLastEpisodePublicId] = useState("");

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
  const episodeItems = useMemo<ComboboxItem[]>(
    () =>
      episodes.map((episode) => ({
        label: t("admin.series.episodes.credits.episode_option", {
          id: episode.publicId,
          title: episode.title,
        }),
        value: episode.publicId,
      })),
    [episodes, t]
  );
  const range = episodesInInclusiveRange(
    episodes,
    firstEpisodePublicId,
    lastEpisodePublicId
  );
  const rangeTooMany = range.length > MAX_BULK_EPISODE_CREDIT_EPISODES;
  const replaceSame = isReplaceSame(operation, from, to);
  const creditComplete = isCreditComplete(operation, credit, from, to);
  const canSubmit = canApplyCreditRange({
    creditComplete,
    hasCreators: creatorItems.length > 0,
    hasRoles: roleItems.length > 0,
    isEpisodePending,
    isPending,
    rangeCount: range.length,
    rangeTooMany,
    replaceSame,
  });
  const preview = creditRangePreview({
    creatorRoles,
    creators,
    credit,
    creditComplete,
    from,
    operation,
    range,
    rangeTooMany,
    replaceSame,
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
      episodeItems={episodeItems}
      episodesEmpty={
        !isEpisodePending && !episodesErrorMessage && episodes.length === 0
      }
      episodesErrorMessage={episodesErrorMessage}
      errorMessage={state && !state.ok ? state.message : ""}
      firstEpisodePublicId={firstEpisodePublicId}
      formAction={formAction}
      from={from}
      hidden={{
        credit,
        firstEpisodePublicId,
        from,
        lastEpisodePublicId,
        operation,
        seriesPublicId,
        tenantId,
        to,
      }}
      isEpisodePending={isEpisodePending}
      isPending={isPending}
      lastEpisodePublicId={lastEpisodePublicId}
      onCreditChange={setCredit}
      onFirstChange={setFirstEpisodePublicId}
      onFromChange={setFrom}
      onLastChange={setLastEpisodePublicId}
      onOperationChange={handleOperationChange}
      onRetryEpisodes={onRetryEpisodes}
      onToChange={setTo}
      operation={operation}
      preview={preview}
      rangeCount={range.length}
      rangeTooMany={rangeTooMany}
      replaceSame={replaceSame}
      roleItems={roleItems}
      to={to}
    />
  );
};
