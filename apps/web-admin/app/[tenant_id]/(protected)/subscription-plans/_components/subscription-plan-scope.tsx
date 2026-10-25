"use client";

import * as MultiCombobox from "@publira/ui-components/multi-combobox";
import { RadioGroup } from "@publira/ui-components/radio-group";
import type { RadioGroupProps } from "@publira/ui-components/radio-group";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { isSubscriptionPlanScopeValue } from "#lib/subscription-plan-shared";
import type {
  SubscriptionPlanScopeValue,
  SubscriptionPlanTargetOption,
} from "#lib/subscription-plan-shared";

interface SubscriptionPlanScopeContextValue {
  labelIds: string[];
  scope: SubscriptionPlanScopeValue;
  seriesIds: string[];
  setLabelIds: (ids: string[]) => void;
  setScope: (scope: SubscriptionPlanScopeValue) => void;
  setSeriesIds: (ids: string[]) => void;
}

const SubscriptionPlanScopeContext =
  createContext<SubscriptionPlanScopeContextValue | null>(null);

const useSubscriptionPlanScope = () => {
  const context = use(SubscriptionPlanScopeContext);
  if (!context) {
    throw new Error("Rendered outside a SubscriptionPlanScope.");
  }

  return context;
};

/**
 * Holds the scope and the labels and series the form saves, and posts all
 * three. Both lists survive switching the scope back and forth while their
 * pickers come and go with it; the Action sends only the one the scope names.
 */
const SubscriptionPlanScopeRoot = ({
  children,
  initialLabelIds,
  initialScope,
  initialSeriesIds,
}: {
  children: ReactNode;
  initialLabelIds: string[];
  initialScope: SubscriptionPlanScopeValue;
  initialSeriesIds: string[];
}) => {
  const [scope, setScope] = useState(initialScope);
  const [labelIds, setLabelIds] = useState(initialLabelIds);
  const [seriesIds, setSeriesIds] = useState(initialSeriesIds);
  const context = useMemo(
    () => ({ labelIds, scope, seriesIds, setLabelIds, setScope, setSeriesIds }),
    [labelIds, scope, seriesIds]
  );

  return (
    <SubscriptionPlanScopeContext value={context}>
      <input name="scope" type="hidden" value={scope} />
      {labelIds.map((id) => (
        <input key={id} name="label_ids" type="hidden" value={id} />
      ))}
      {seriesIds.map((id) => (
        <input key={id} name="series_ids" type="hidden" value={id} />
      ))}
      {children}
    </SubscriptionPlanScopeContext>
  );
};

/** The scope picker; `items` carry the rendered wording of each scope. */
const SubscriptionPlanScopeRadioGroup = ({
  items,
}: {
  items: RadioGroupProps["items"];
}) => {
  const { scope, setScope } = useSubscriptionPlanScope();

  return (
    <RadioGroup
      items={items}
      onValueChange={(value) => {
        if (isSubscriptionPlanScopeValue(value)) {
          setScope(value);
        }
      }}
      value={scope}
    />
  );
};

/** Renders its children only while the plan is of the scope it names. */
const SubscriptionPlanScopeWhen = ({
  children,
  scope,
}: {
  children: ReactNode;
  scope: SubscriptionPlanScopeValue;
}) => (useSubscriptionPlanScope().scope === scope ? children : null);

const toItems = (options: SubscriptionPlanTargetOption[]) =>
  options.map((option) => ({ label: option.name, value: option.id }));

/** The labels a plan of labels opens. */
const SubscriptionPlanScopeLabelPicker = ({
  labels,
}: {
  labels: SubscriptionPlanTargetOption[];
}) => {
  const t = useClientMessages();
  const { labelIds, setLabelIds } = useSubscriptionPlanScope();
  const items = useMemo(() => toItems(labels), [labels]);

  return (
    <MultiCombobox.Root
      items={items}
      onValueChange={setLabelIds}
      value={labelIds}
    >
      <MultiCombobox.InputGroup>
        <MultiCombobox.Chips>
          {(selected) => (
            <>
              {selected.map((item) => (
                <MultiCombobox.Chip item={item} key={item.value}>
                  {item.label}
                  <MultiCombobox.ChipRemove
                    aria-label={t(
                      "admin.subscription_plans.form.labels_remove",
                      {
                        name: item.label,
                      }
                    )}
                  />
                </MultiCombobox.Chip>
              ))}
              <MultiCombobox.Input
                placeholder={
                  selected.length > 0
                    ? ""
                    : t("admin.subscription_plans.form.labels_search")
                }
              />
            </>
          )}
        </MultiCombobox.Chips>
      </MultiCombobox.InputGroup>
      <MultiCombobox.Popup>
        <MultiCombobox.Empty>
          <ClientMessage message="admin.subscription_plans.form.labels_no_match" />
        </MultiCombobox.Empty>
        <MultiCombobox.Items />
      </MultiCombobox.Popup>
    </MultiCombobox.Root>
  );
};

/** The series a plan of series opens. */
const SubscriptionPlanScopeSeriesPicker = ({
  series,
}: {
  series: SubscriptionPlanTargetOption[];
}) => {
  const t = useClientMessages();
  const { seriesIds, setSeriesIds } = useSubscriptionPlanScope();
  const items = useMemo(() => toItems(series), [series]);

  return (
    <MultiCombobox.Root
      items={items}
      onValueChange={setSeriesIds}
      value={seriesIds}
    >
      <MultiCombobox.InputGroup>
        <MultiCombobox.Chips>
          {(selected) => (
            <>
              {selected.map((item) => (
                <MultiCombobox.Chip item={item} key={item.value}>
                  {item.label}
                  <MultiCombobox.ChipRemove
                    aria-label={t(
                      "admin.subscription_plans.form.series_remove",
                      {
                        name: item.label,
                      }
                    )}
                  />
                </MultiCombobox.Chip>
              ))}
              <MultiCombobox.Input
                placeholder={
                  selected.length > 0
                    ? ""
                    : t("admin.subscription_plans.form.series_search")
                }
              />
            </>
          )}
        </MultiCombobox.Chips>
      </MultiCombobox.InputGroup>
      <MultiCombobox.Popup>
        <MultiCombobox.Empty>
          <ClientMessage message="admin.subscription_plans.form.series_no_match" />
        </MultiCombobox.Empty>
        <MultiCombobox.Items />
      </MultiCombobox.Popup>
    </MultiCombobox.Root>
  );
};

export {
  SubscriptionPlanScopeRoot as Root,
  SubscriptionPlanScopeLabelPicker as LabelPicker,
  SubscriptionPlanScopeRadioGroup as RadioGroup,
  SubscriptionPlanScopeSeriesPicker as SeriesPicker,
  SubscriptionPlanScopeWhen as When,
};
