"use client";

import { Button } from "@publira/ui-components/button";
import * as Combobox from "@publira/ui-components/combobox";
import { FormMessage } from "@publira/ui-components/form-message";
import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { useClientMessages } from "#components/client-message";
import { isPromotionCodeTargetKind } from "#lib/promotion-code-shared";
import type {
  PromotionCodeTargetKindValue,
  PromotionCodeTargetOption,
} from "#lib/promotion-code-shared";

import { listPromotionCodeTargetOptionsAction } from "../_lib/actions";

/** A target read out of a series: the series is picked first. */
type SeriesChildKind = "episode" | "volume";

const isSeriesChildKind = (
  kind: PromotionCodeTargetKindValue
): kind is SeriesChildKind => kind === "episode" || kind === "volume";

interface PromotionCodeTargetContextValue {
  childId: string;
  childItems: Combobox.Item[];
  childrenErrorMessage?: string;
  isChildPending: boolean;
  kind: PromotionCodeTargetKindValue;
  labelId: string;
  onChildChange: (nextChildId: string) => void;
  onKindChange: (nextKind: PromotionCodeTargetKindValue) => void;
  onLabelChange: (nextLabelId: string) => void;
  onRetryChildren: () => void;
  onSeriesChange: (nextSeriesId: string) => void;
  seriesId: string;
}

const PromotionCodeTargetContext =
  createContext<PromotionCodeTargetContextValue | null>(null);

const usePromotionCodeTarget = () => {
  const context = use(PromotionCodeTargetContext);

  if (!context) {
    throw new Error("Rendered outside a PromotionCodeTarget.");
  }

  return context;
};

const toItems = (options: PromotionCodeTargetOption[]): Combobox.Item[] =>
  options.map((option) => ({ label: option.label, value: option.id }));

/**
 * What the code applies to, posted as `target_kind` and `target_id`: the
 * whole catalog, a label, a series, or a volume or an episode of a series,
 * whose choices are loaded once the series is picked. A target the server
 * then finds gone is refused on `target_id`.
 */
const PromotionCodeTargetRoot = ({
  children,
  tenantId,
}: {
  children: ReactNode;
  tenantId: string;
}) => {
  const locale = useAdminLocale();
  const [isChildPending, startChildTransition] = useTransition();
  const [kind, setKind] = useState<PromotionCodeTargetKindValue>("catalog");
  const [labelId, setLabelId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [childId, setChildId] = useState("");

  const [childOptions, setChildOptions] = useState<PromotionCodeTargetOption[]>(
    []
  );

  const [childrenErrorMessage, setChildrenErrorMessage] = useState<string>();
  const childRequestIdRef = useRef(0);

  const loadChildren = useCallback(
    (childKind: SeriesChildKind, nextSeriesId: string) => {
      const requestId = childRequestIdRef.current + 1;
      childRequestIdRef.current = requestId;

      startChildTransition(async () => {
        const result = await listPromotionCodeTargetOptionsAction(
          { kind: childKind, seriesId: nextSeriesId, tenantId },
          locale
        );

        if (requestId !== childRequestIdRef.current) {
          return;
        }

        setChildOptions(result.options);
        setChildrenErrorMessage(result.ok ? undefined : result.message);
      });
    },
    [locale, tenantId]
  );

  // A volume and an episode of the same series are different choices, so
  // switching between them, or to another series, loads the choices afresh.
  const resetChildren = useCallback(
    (nextKind: PromotionCodeTargetKindValue, nextSeriesId: string) => {
      childRequestIdRef.current += 1;
      setChildId("");
      setChildOptions([]);
      setChildrenErrorMessage(undefined);

      if (isSeriesChildKind(nextKind) && nextSeriesId !== "") {
        loadChildren(nextKind, nextSeriesId);
      }
    },
    [loadChildren]
  );

  const childItems = useMemo(() => toItems(childOptions), [childOptions]);

  const value = useMemo<PromotionCodeTargetContextValue>(
    () => ({
      childId,
      childItems,
      childrenErrorMessage,
      isChildPending,
      kind,
      labelId,
      onChildChange: setChildId,
      onKindChange: (nextKind) => {
        setKind(nextKind);
        resetChildren(nextKind, seriesId);
      },
      onLabelChange: setLabelId,
      onRetryChildren: () => {
        if (isSeriesChildKind(kind) && seriesId !== "") {
          setChildrenErrorMessage(undefined);
          loadChildren(kind, seriesId);
        }
      },
      onSeriesChange: (nextSeriesId) => {
        setSeriesId(nextSeriesId);
        resetChildren(kind, nextSeriesId);
      },
      seriesId,
    }),
    [
      childId,
      childItems,
      childrenErrorMessage,
      isChildPending,
      kind,
      labelId,
      loadChildren,
      resetChildren,
      seriesId,
    ]
  );

  let targetId = "";

  if (kind === "label") {
    targetId = labelId;
  } else if (kind === "series") {
    targetId = seriesId;
  } else if (isSeriesChildKind(kind)) {
    targetId = childId;
  }

  return (
    <PromotionCodeTargetContext value={value}>
      <input name="target_kind" type="hidden" value={kind} />
      <input name="target_id" type="hidden" value={targetId} />
      {children}
    </PromotionCodeTargetContext>
  );
};

/** The kind picker; `items` carry the rendered wording of each kind. */
const PromotionCodeTargetRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { kind, onKindChange } = usePromotionCodeTarget();

  return (
    <RadioGroup
      items={items}
      onValueChange={(value) => {
        if (isPromotionCodeTargetKind(value)) {
          onKindChange(value);
        }
      }}
      value={kind}
    />
  );
};

/** Renders its children only while the target is of one of `kinds`. */
const PromotionCodeTargetWhen = ({
  children,
  kinds,
}: {
  children: ReactNode;
  kinds: readonly PromotionCodeTargetKindValue[];
}) => (kinds.includes(usePromotionCodeTarget().kind) ? children : null);

/** The label a code of a label applies to; `children` are the picker's parts. */
const PromotionCodeTargetLabelCombobox = ({
  children,
  labels,
}: {
  children: ReactNode;
  labels: PromotionCodeTargetOption[];
}) => {
  const { labelId, onLabelChange } = usePromotionCodeTarget();
  const items = useMemo(() => toItems(labels), [labels]);

  return (
    <Combobox.Root items={items} onValueChange={onLabelChange} value={labelId}>
      {children}
    </Combobox.Root>
  );
};

/**
 * The series a code of a series applies to, or the one whose volumes or
 * episodes are offered; `children` are the picker's parts.
 */
const PromotionCodeTargetSeriesCombobox = ({
  children,
  series,
}: {
  children: ReactNode;
  series: PromotionCodeTargetOption[];
}) => {
  const { onSeriesChange, seriesId } = usePromotionCodeTarget();
  const items = useMemo(() => toItems(series), [series]);

  return (
    <Combobox.Root
      items={items}
      onValueChange={onSeriesChange}
      value={seriesId}
    >
      {children}
    </Combobox.Root>
  );
};

/**
 * The volume or the episode the code applies to; `children` are the picker's
 * parts. It opens once a series is picked and its choices are in.
 */
const PromotionCodeTargetChildCombobox = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { childId, childItems, isChildPending, onChildChange, seriesId } =
    usePromotionCodeTarget();

  return (
    <Combobox.Root
      disabled={isChildPending || seriesId === ""}
      items={childItems}
      onValueChange={onChildChange}
      value={childId}
    >
      {children}
    </Combobox.Root>
  );
};

/** The volume or episode picker's text box, which says so while the choices load. */
const PromotionCodeTargetChildInput = () => {
  const t = useClientMessages();
  const { isChildPending, kind } = usePromotionCodeTarget();

  if (isChildPending) {
    return (
      <Combobox.Input
        placeholder={t("admin.promotion_codes.form.target_loading")}
      />
    );
  }

  return (
    <Combobox.Input
      placeholder={
        kind === "volume"
          ? t("admin.promotion_codes.form.target_volume_placeholder")
          : t("admin.promotion_codes.form.target_episode_placeholder")
      }
    />
  );
};

/** Why the choices could not be loaded, and the retry; `children` are its wording. */
const PromotionCodeTargetChildLoadError = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { childrenErrorMessage, onRetryChildren } = usePromotionCodeTarget();

  return childrenErrorMessage ? (
    <>
      <FormMessage variant="destructive">{childrenErrorMessage}</FormMessage>
      <Button onClick={onRetryChildren} type="button" variant="outline">
        {children}
      </Button>
    </>
  ) : null;
};

/** Renders its children while a series is picked, or while none is when `chosen` is false. */
const PromotionCodeTargetSeriesWhile = ({
  children,
  chosen,
}: {
  children: ReactNode;
  chosen: boolean;
}) => ((usePromotionCodeTarget().seriesId !== "") === chosen ? children : null);

export {
  PromotionCodeTargetRoot as Root,
  PromotionCodeTargetChildCombobox as ChildCombobox,
  PromotionCodeTargetChildInput as ChildInput,
  PromotionCodeTargetChildLoadError as ChildLoadError,
  PromotionCodeTargetLabelCombobox as LabelCombobox,
  PromotionCodeTargetRadioGroup as RadioGroup,
  PromotionCodeTargetSeriesCombobox as SeriesCombobox,
  PromotionCodeTargetSeriesWhile as SeriesWhile,
  PromotionCodeTargetWhen as When,
};
