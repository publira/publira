"use client";

import { getLocaleLabel, toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Select } from "@publira/ui-components/select";
import { createContext, use, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
import type { CountAnnouncementAudienceResult } from "#lib/announcement";
import type { SeriesItem } from "#lib/series";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

import { countAnnouncementAudienceAction } from "../_lib/actions";
import type {
  AnnouncementAudienceCondition,
  AnnouncementConditionType,
  AnnouncementSubscriptionStateValue,
} from "../announcement-types";

/** Every condition an audience can name, in the order the form offers them. */
const CONDITION_TYPES: readonly AnnouncementConditionType[] = [
  "follows_series",
  "bought_series_episode",
  "subscription",
  "never_purchased",
  "last_read_days_ago",
  "signed_up_within_days",
  "locale",
  "has_mobile_push_device",
];

/** The fewest and most days a day-count condition takes, as the API bounds them. */
const DAYS_MIN = 1;
const DAYS_MAX = 3650;

/** How long the conditions stay unchanged before the reach is counted again. */
const REACH_DEBOUNCE_MS = 400;

/**
 * The plan select's value for "any plan": Base UI keeps an empty value apart
 * from a chosen one only through an item of its own.
 */
const ANY_PLAN = "*";

/** A series a condition can name. */
export type AudienceSeries = Pick<SeriesItem, "publicId" | "title">;

/** A plan a subscription condition can name. */
export type AudiencePlan = Pick<SubscriptionPlanItem, "name" | "publicId">;

/**
 * One condition as the form edits it: every input kept as typed, so a row that
 * is still being filled in holds what the operator wrote rather than a value
 * the API would take.
 */
interface ConditionRow {
  type: AnnouncementConditionType;
  seriesPublicId: string;
  planPublicId: string;
  state: AnnouncementSubscriptionStateValue;
  days: string;
  locale: string;
}

const toRow = (condition: AnnouncementAudienceCondition): ConditionRow => ({
  days: "days" in condition ? String(condition.days) : "",
  locale: "locale" in condition ? condition.locale : "",
  planPublicId: "planPublicId" in condition ? condition.planPublicId : "",
  seriesPublicId: "seriesPublicId" in condition ? condition.seriesPublicId : "",
  state: "state" in condition ? condition.state : "active",
  type: condition.type,
});

/** The day count a row holds, or `null` while it is not one the API takes. */
const toDays = (value: string): number | null => {
  const days = Number(value);

  return value.trim() !== "" &&
    Number.isInteger(days) &&
    days >= DAYS_MIN &&
    days <= DAYS_MAX
    ? days
    : null;
};

/** The condition a row names, or `null` while one of its inputs is unfilled. */
const toCondition = (
  row: ConditionRow,
  locales: readonly Locale[]
): AnnouncementAudienceCondition | null => {
  switch (row.type) {
    case "follows_series":
    case "bought_series_episode": {
      return row.seriesPublicId
        ? { seriesPublicId: row.seriesPublicId, type: row.type }
        : null;
    }

    case "subscription": {
      return {
        planPublicId: row.planPublicId,
        state: row.state,
        type: row.type,
      };
    }

    case "last_read_days_ago":
    case "signed_up_within_days": {
      const days = toDays(row.days);

      return days === null ? null : { days, type: row.type };
    }

    case "locale": {
      const locale = locales.find((code) => code === row.locale);

      return locale ? { locale, type: row.type } : null;
    }

    case "never_purchased":
    case "has_mobile_push_device": {
      return { type: row.type };
    }

    default: {
      return row.type satisfies never;
    }
  }
};

type AudienceMode = "everyone" | "targeted";

interface AnnouncementAudienceContextValue {
  mode: AudienceMode;
  setMode: (mode: AudienceMode) => void;
  rows: readonly ConditionRow[];
  setRows: (rows: readonly ConditionRow[]) => void;
}

const AnnouncementAudienceContext =
  createContext<AnnouncementAudienceContextValue | null>(null);

const useAnnouncementAudience = () => {
  const context = use(AnnouncementAudienceContext);

  if (!context) {
    throw new Error(
      "AnnouncementAudience slots must be rendered inside AnnouncementAudience."
    );
  }

  return context;
};

/**
 * Whether the announcement is addressed by conditions: the targeted choice with
 * at least one condition on it. Choosing it with none adds nothing to exclude
 * yet, so the controls a condition rules out stay open until one is added.
 */
const useAnnouncementTargeted = (): boolean => {
  const { mode, rows } = useAnnouncementAudience();

  return mode === "targeted" && rows.length > 0;
};

/**
 * Who the announcement is for, shared by the parts of the form it decides:
 * the audience's own fields, and the delivery and banner controls a targeted
 * announcement rules out.
 */
const AnnouncementAudience = ({
  children,
  initialConditions,
}: {
  children: ReactNode;
  /** The stored audience on edit; `null` addresses everyone. */
  initialConditions: readonly AnnouncementAudienceCondition[] | null;
}) => {
  const [mode, setMode] = useState<AudienceMode>(
    initialConditions ? "targeted" : "everyone"
  );

  const [rows, setRows] = useState<readonly ConditionRow[]>(() =>
    (initialConditions ?? []).map((condition) => toRow(condition))
  );

  const context = useMemo(
    () => ({ mode, rows, setMode, setRows }),
    [mode, rows]
  );

  return (
    <AnnouncementAudienceContext value={context}>
      {children}
    </AnnouncementAudienceContext>
  );
};

/** The choice between everyone and the readers the conditions select, posted as `audience`. */
const AnnouncementAudienceMode = () => {
  const { mode, setMode } = useAnnouncementAudience();

  return (
    <RadioGroup
      items={[
        {
          label: (
            <ClientMessage message="admin.announcements.form.audience_everyone" />
          ),
          value: "everyone",
        },
        {
          description: (
            <ClientMessage message="admin.announcements.form.audience_targeted_description" />
          ),
          label: (
            <ClientMessage message="admin.announcements.form.audience_targeted" />
          ),
          value: "targeted",
        },
      ]}
      name="audience"
      onValueChange={(value) =>
        setMode(value === "targeted" ? "targeted" : "everyone")
      }
      value={mode}
    />
  );
};

/** The name of one condition type. Each branch spells its key out. */
const ConditionLabel = ({ type }: { type: AnnouncementConditionType }) => {
  switch (type) {
    case "follows_series": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.follows_series" />
      );
    }

    case "bought_series_episode": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.bought_series_episode" />
      );
    }

    case "subscription": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.subscription" />
      );
    }

    case "never_purchased": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.never_purchased" />
      );
    }

    case "last_read_days_ago": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.last_read_days_ago" />
      );
    }

    case "signed_up_within_days": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.signed_up_within_days" />
      );
    }

    case "locale": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.locale" />
      );
    }

    case "has_mobile_push_device": {
      return (
        <ClientMessage message="admin.announcements.form.audience_condition.has_mobile_push_device" />
      );
    }

    default: {
      return type satisfies never;
    }
  }
};

/** The series a series condition names, posted under the condition's own field. */
const AudienceSeriesField = ({
  errorMessage,
  name,
  onChange,
  series,
  value,
}: {
  errorMessage?: string;
  name: string;
  onChange: (seriesPublicId: string) => void;
  series: readonly AudienceSeries[];
  value: string;
}) => {
  const locale = useAdminLocale();
  const t = useClientMessages();

  const items = useMemo<Combobox.Item[]>(
    () =>
      series
        .map((item) => ({ label: item.title, value: item.publicId }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [locale, series]
  );

  return (
    <Field.Root>
      <Field.Label required>
        <ClientMessage message="admin.announcements.form.audience_series" />
      </Field.Label>
      <Field.Content>
        <Combobox.Root items={items} onValueChange={onChange} value={value}>
          <Combobox.Input
            placeholder={t(
              "admin.announcements.form.audience_series_placeholder"
            )}
          />
          <Combobox.Popup>
            <Combobox.Empty>
              <ClientMessage message="admin.announcements.form.audience_series_empty" />
            </Combobox.Empty>
            <Combobox.Items />
          </Combobox.Popup>
        </Combobox.Root>
        <input name={name} type="hidden" value={value} />
        {errorMessage ? (
          <FormMessage variant="destructive">{errorMessage}</FormMessage>
        ) : null}
      </Field.Content>
    </Field.Root>
  );
};

/** The plan and the state a subscription condition asks for. */
const AudienceSubscriptionFields = ({
  errorMessage,
  onChange,
  plans,
  row,
}: {
  errorMessage?: string;
  onChange: (patch: Partial<ConditionRow>) => void;
  plans: readonly AudiencePlan[];
  row: ConditionRow;
}) => {
  const t = useClientMessages();

  const planItems = [
    {
      label: t("admin.announcements.form.audience_any_plan"),
      value: ANY_PLAN,
    },
    ...plans.map((plan) => ({ label: plan.name, value: plan.publicId })),
  ];

  // A stored plan the list could not name is still the one the condition
  // holds, so it stays selectable under its id rather than reading as "any".
  if (
    row.planPublicId &&
    !plans.some(({ publicId }) => publicId === row.planPublicId)
  ) {
    planItems.push({ label: row.planPublicId, value: row.planPublicId });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field.Root>
        <Field.Label>
          <ClientMessage message="admin.announcements.form.audience_plan" />
        </Field.Label>
        <Field.Content>
          <Select
            items={planItems}
            onValueChange={(value) =>
              onChange({ planPublicId: value === ANY_PLAN ? "" : value })
            }
            value={row.planPublicId || ANY_PLAN}
          />
          <input
            name="audience_subscription_plan"
            type="hidden"
            value={row.planPublicId}
          />
          {errorMessage ? (
            <FormMessage variant="destructive">{errorMessage}</FormMessage>
          ) : null}
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label>
          <ClientMessage message="admin.announcements.form.audience_plan_state" />
        </Field.Label>
        <Field.Content>
          <Select
            items={[
              {
                label: t("admin.announcements.form.audience_plan_state_active"),
                value: "active",
              },
              {
                label: t("admin.announcements.form.audience_plan_state_ended"),
                value: "ended",
              },
            ]}
            name="audience_subscription_state"
            onValueChange={(value) =>
              onChange({ state: value === "ended" ? "ended" : "active" })
            }
            value={row.state}
          />
        </Field.Content>
      </Field.Root>
    </div>
  );
};

/** The day count a day-count condition takes, posted under the condition's own field. */
const AudienceDaysField = ({
  name,
  onChange,
  value,
}: {
  name: string;
  onChange: (days: string) => void;
  value: string;
}) => (
  <Field.Root>
    <Field.Label required>
      <ClientMessage message="admin.announcements.form.audience_days" />
    </Field.Label>
    <Field.Content>
      <Input
        className="w-32"
        inputMode="numeric"
        max={DAYS_MAX}
        min={DAYS_MIN}
        name={name}
        onChange={(event) => onChange(event.currentTarget.value)}
        required
        step={1}
        type="number"
        value={value}
      />
    </Field.Content>
  </Field.Root>
);

/** The language a locale condition names, from the ones the site offers. */
const AudienceLocaleField = ({
  locales,
  onChange,
  value,
}: {
  locales: readonly Locale[];
  onChange: (locale: string) => void;
  value: string;
}) => (
  <Field.Root>
    <Field.Label>
      <ClientMessage message="admin.announcements.form.audience_condition.locale" />
    </Field.Label>
    <Field.Content>
      <Select
        items={locales.map((code) => ({
          label: getLocaleLabel(code),
          value: code,
        }))}
        name="audience_locale_locale"
        onValueChange={onChange}
        value={value}
      />
    </Field.Content>
  </Field.Root>
);

interface AudienceOptions {
  /**
   * The languages the site offers, which a locale condition picks from, the
   * default one first: a new locale row opens on it.
   */
  locales: readonly Locale[];
  plans: readonly AudiencePlan[];
  /** Why the plans could not be listed, beside the plan select. */
  plansErrorMessage?: string;
  series: readonly AudienceSeries[];
  /** Why the series could not be listed, beside every series combobox. */
  seriesErrorMessage?: string;
}

/** One condition's inputs, and the control that takes it off the audience. */
const AudienceConditionRow = ({
  onChange,
  onRemove,
  options,
  row,
}: {
  onChange: (patch: Partial<ConditionRow>) => void;
  onRemove: () => void;
  options: AudienceOptions;
  row: ConditionRow;
}) => (
  // A floated legend is laid out as a grid item rather than drawn on the
  // border, so it shares the first row with Remove and still names the group.
  <fieldset className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-border p-3">
    <legend className="float-left text-sm font-medium">
      <ConditionLabel type={row.type} />
    </legend>
    <Button onClick={onRemove} size="sm" type="button" variant="ghost">
      <ClientMessage message="admin.announcements.form.audience_remove" />
    </Button>
    <input name="audience_condition" type="hidden" value={row.type} />
    <div className="col-span-full grid gap-3">
      {row.type === "follows_series" || row.type === "bought_series_episode" ? (
        <AudienceSeriesField
          errorMessage={options.seriesErrorMessage}
          name={`audience_${row.type}_series`}
          onChange={(seriesPublicId) => onChange({ seriesPublicId })}
          series={options.series}
          value={row.seriesPublicId}
        />
      ) : null}
      {row.type === "subscription" ? (
        <AudienceSubscriptionFields
          errorMessage={options.plansErrorMessage}
          onChange={onChange}
          plans={options.plans}
          row={row}
        />
      ) : null}
      {row.type === "last_read_days_ago" ||
      row.type === "signed_up_within_days" ? (
        <AudienceDaysField
          name={`audience_${row.type}_days`}
          onChange={(days) => onChange({ days })}
          value={row.days}
        />
      ) : null}
      {row.type === "locale" ? (
        <AudienceLocaleField
          locales={options.locales}
          onChange={(locale) => onChange({ locale })}
          value={row.locale}
        />
      ) : null}

      <ActionForm.FieldError name={`audience.${row.type}`} />
    </div>
  </fieldset>
);

/** The select that adds a condition not on the audience yet. */
const AudienceConditionAdd = ({
  offered,
  onAdd,
}: {
  offered: readonly AnnouncementConditionType[];
  onAdd: (type: AnnouncementConditionType) => void;
}) => {
  const t = useClientMessages();

  const labels: Record<AnnouncementConditionType, string> = {
    bought_series_episode: t(
      "admin.announcements.form.audience_condition.bought_series_episode"
    ),
    follows_series: t(
      "admin.announcements.form.audience_condition.follows_series"
    ),
    has_mobile_push_device: t(
      "admin.announcements.form.audience_condition.has_mobile_push_device"
    ),
    last_read_days_ago: t(
      "admin.announcements.form.audience_condition.last_read_days_ago"
    ),
    locale: t("admin.announcements.form.audience_condition.locale"),
    never_purchased: t(
      "admin.announcements.form.audience_condition.never_purchased"
    ),
    signed_up_within_days: t(
      "admin.announcements.form.audience_condition.signed_up_within_days"
    ),
    subscription: t("admin.announcements.form.audience_condition.subscription"),
  };

  return (
    <Field.Root>
      <Field.Label className="sr-only">
        <ClientMessage message="admin.announcements.form.audience_add" />
      </Field.Label>
      <Field.Content>
        <Select
          className="sm:w-80"
          items={offered.map((type) => ({ label: labels[type], value: type }))}
          onValueChange={(value) => {
            const type = offered.find((candidate) => candidate === value);

            if (type) {
              onAdd(type);
            }
          }}
          placeholder={
            <ClientMessage message="admin.announcements.form.audience_add" />
          }
          value={null}
        />
      </Field.Content>
    </Field.Root>
  );
};

/**
 * How many readers the conditions select now, counted once they have stayed
 * unchanged for a moment. It is advice: the submission never waits on it, and
 * a set with an unfilled input is not counted at all.
 */
const AudienceReach = ({
  conditions,
  tenantId,
}: {
  /** The conditions to count, or `null` while one of them is unfilled. */
  conditions: readonly AnnouncementAudienceCondition[] | null;
  tenantId: string;
}) => {
  // The request the count answers, so a count of conditions that have changed
  // since reads as pending rather than as the new one.
  const request = conditions ? JSON.stringify(conditions) : "";

  const [reach, setReach] = useState<{
    request: string;
    result: CountAnnouncementAudienceResult;
  } | null>(null);

  // The count is the API's: an Effect keeps it in step with the conditions,
  // and a timer holds it back until they stop changing.
  useEffect(() => {
    if (!request) {
      return;
    }

    const cleanup = new AbortController();

    const count = async () => {
      let result: CountAnnouncementAudienceResult = { ok: false };

      try {
        result = await countAnnouncementAudienceAction({
          conditions: JSON.parse(request),
          tenantId,
        });
      } catch {
        // A count is advice; one that could not be made says so and keeps the
        // form usable rather than reaching an error boundary.
      }

      if (!cleanup.signal.aborted) {
        setReach({ request, result });
      }
    };

    const timer = setTimeout(count, REACH_DEBOUNCE_MS);

    return () => {
      cleanup.abort();
      clearTimeout(timer);
    };
  }, [request, tenantId]);

  if (!request) {
    return null;
  }

  const result = reach?.request === request ? reach.result : null;

  return (
    <FormMessage variant={result && !result.ok ? "warning" : "info"}>
      {result === null ? (
        <ClientMessage message="admin.announcements.form.audience_reach_pending" />
      ) : null}
      {result?.ok ? (
        <ClientMessage
          message="admin.announcements.form.audience_reach"
          values={{ count: result.readerCount }}
        />
      ) : null}
      {result && !result.ok ? (
        <ClientMessage message="admin.announcements.form.audience_reach_failed" />
      ) : null}
    </FormMessage>
  );
};

/**
 * The conditions of a targeted announcement: a row each, the select that adds
 * one, and the reach. Nothing renders while the announcement is for everyone,
 * so no condition is posted then.
 */
const AnnouncementAudienceConditions = ({
  tenantId,
  ...options
}: AudienceOptions & { tenantId: string }) => {
  const { mode, rows, setRows } = useAnnouncementAudience();

  if (mode !== "targeted") {
    return null;
  }

  const offered = CONDITION_TYPES.filter(
    (type) =>
      !rows.some((row) => row.type === type) &&
      (type !== "locale" || options.locales.length > 0)
  );

  const conditions = rows.flatMap((row) => {
    const condition = toCondition(row, options.locales);

    return condition ? [condition] : [];
  });

  // A set with an unfilled row is not counted: its reach would be another set's.
  const complete = rows.length > 0 && conditions.length === rows.length;

  const update = (
    type: AnnouncementConditionType,
    patch: Partial<ConditionRow>
  ) =>
    setRows(
      rows.map((row) => (row.type === type ? { ...row, ...patch } : row))
    );

  const add = (type: AnnouncementConditionType) =>
    setRows([
      ...rows,
      {
        days: "",
        locale: options.locales[0] ?? "",
        planPublicId: "",
        seriesPublicId: "",
        state: "active",
        type,
      },
    ]);

  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <AudienceConditionRow
          key={row.type}
          onChange={(patch) => update(row.type, patch)}
          onRemove={() => setRows(rows.filter(({ type }) => type !== row.type))}
          options={options}
          row={row}
        />
      ))}
      {offered.length > 0 ? (
        <AudienceConditionAdd offered={offered} onAdd={add} />
      ) : null}
      <AudienceReach
        conditions={complete ? conditions : null}
        tenantId={tenantId}
      />
    </div>
  );
};

/**
 * The Send to everyone switch, posted as `delivery`. A targeted announcement
 * reaches only its readers, so the switch is off and closed while there are
 * conditions, and comes back as it started once they are gone.
 */
const AnnouncementDeliveryCheckbox = ({
  defaultChecked = false,
}: {
  defaultChecked?: boolean;
}) => {
  const targeted = useAnnouncementTargeted();

  return (
    <Checkbox
      defaultChecked={!targeted && defaultChecked}
      disabled={targeted}
      key={String(targeted)}
      name="delivery"
      value="everyone"
    />
  );
};

/** Renders its children while the announcement is addressed by conditions. */
const AnnouncementAudienceWhileTargeted = ({
  children,
}: {
  children: ReactNode;
}) => (useAnnouncementTargeted() ? children : null);

export {
  AnnouncementAudience as Root,
  AnnouncementAudienceConditions as Conditions,
  AnnouncementAudienceMode as Mode,
  AnnouncementAudienceWhileTargeted as WhileTargeted,
  AnnouncementDeliveryCheckbox as DeliveryCheckbox,
  useAnnouncementTargeted as useTargeted,
};
