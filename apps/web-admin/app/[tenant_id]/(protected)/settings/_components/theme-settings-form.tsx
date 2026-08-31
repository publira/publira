"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import {
  useActionState,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { AdminMessageKey } from "#lib/locale";
import { useTenantId } from "#lib/use-tenant-id";

import type { ThemeSettingsActionState } from "../settings-types";

interface ThemeSettingsFormProps {
  action: (
    prevState: ThemeSettingsActionState,
    formData: FormData
  ) => Promise<ThemeSettingsActionState>;
  initialTheme: TenantThemeColors;
}

interface ColorSwatchInputProps {
  name: string;
  pickerLabel: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const ColorSwatchInput = ({
  name,
  pickerLabel,
  value,
  onChange,
}: ColorSwatchInputProps) => {
  const pickerId = useId();
  return (
    <div className="relative flex max-w-48 items-center">
      <label
        aria-label={pickerLabel}
        className="absolute left-2 h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-sm border"
        htmlFor={pickerId}
        style={{ backgroundColor: value }}
      >
        <input
          className="sr-only"
          id={pickerId}
          onChange={onChange}
          tabIndex={-1}
          type="color"
          value={value}
        />
      </label>
      <Input
        className="pl-10"
        name={name}
        onChange={onChange}
        pattern="#[0-9a-fA-F]{6}"
        placeholder="#000000"
        required
        type="text"
        value={value}
      />
    </div>
  );
};

type ColorKey = keyof TenantThemeColors;

interface ColorFieldConfig {
  key: ColorKey;
  formName: string;
  labelKey: AdminMessageKey;
  descriptionKey?: AdminMessageKey;
  inlineWithNext?: boolean;
}

const colorGroups: {
  titleKey: AdminMessageKey;
  descriptionKey: AdminMessageKey;
  fields: ColorFieldConfig[];
}[] = [
  {
    descriptionKey: "admin.settings.theme.groups.brand.description",
    fields: [
      {
        descriptionKey: "admin.settings.theme.colors.primary.description",
        formName: "primary_color",
        inlineWithNext: true,
        key: "primaryColor",
        labelKey: "admin.settings.theme.colors.primary.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.primary_foreground.description",
        formName: "primary_foreground_color",
        key: "primaryForegroundColor",
        labelKey: "admin.settings.theme.colors.primary_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.secondary.description",
        formName: "secondary_color",
        inlineWithNext: true,
        key: "secondaryColor",
        labelKey: "admin.settings.theme.colors.secondary.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.secondary_foreground.description",
        formName: "secondary_foreground_color",
        key: "secondaryForegroundColor",
        labelKey: "admin.settings.theme.colors.secondary_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.accent.description",
        formName: "accent_color",
        inlineWithNext: true,
        key: "accentColor",
        labelKey: "admin.settings.theme.colors.accent.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.accent_foreground.description",
        formName: "accent_foreground_color",
        key: "accentForegroundColor",
        labelKey: "admin.settings.theme.colors.accent_foreground.label",
      },
    ],
    titleKey: "admin.settings.theme.groups.brand.title",
  },
  {
    descriptionKey: "admin.settings.theme.groups.surface.description",
    fields: [
      {
        descriptionKey: "admin.settings.theme.colors.background.description",
        formName: "background_color",
        inlineWithNext: true,
        key: "backgroundColor",
        labelKey: "admin.settings.theme.colors.background.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.foreground.description",
        formName: "foreground_color",
        key: "foregroundColor",
        labelKey: "admin.settings.theme.colors.foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.surface.description",
        formName: "surface_color",
        inlineWithNext: true,
        key: "surfaceColor",
        labelKey: "admin.settings.theme.colors.surface.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.surface_foreground.description",
        formName: "surface_foreground_color",
        key: "surfaceForegroundColor",
        labelKey: "admin.settings.theme.colors.surface_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.card.description",
        formName: "card_color",
        inlineWithNext: true,
        key: "cardColor",
        labelKey: "admin.settings.theme.colors.card.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.card_foreground.description",
        formName: "card_foreground_color",
        key: "cardForegroundColor",
        labelKey: "admin.settings.theme.colors.card_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.popover.description",
        formName: "popover_color",
        inlineWithNext: true,
        key: "popoverColor",
        labelKey: "admin.settings.theme.colors.popover.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.popover_foreground.description",
        formName: "popover_foreground_color",
        key: "popoverForegroundColor",
        labelKey: "admin.settings.theme.colors.popover_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.muted.description",
        formName: "muted_color",
        inlineWithNext: true,
        key: "mutedColor",
        labelKey: "admin.settings.theme.colors.muted.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.muted_foreground.description",
        formName: "muted_foreground_color",
        key: "mutedForegroundColor",
        labelKey: "admin.settings.theme.colors.muted_foreground.label",
      },
    ],
    titleKey: "admin.settings.theme.groups.surface.title",
  },
  {
    descriptionKey: "admin.settings.theme.groups.ui.description",
    fields: [
      {
        descriptionKey: "admin.settings.theme.colors.border.description",
        formName: "border_color",
        key: "borderColor",
        labelKey: "admin.settings.theme.colors.border.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.input.description",
        formName: "input_color",
        key: "inputColor",
        labelKey: "admin.settings.theme.colors.input.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.ring.description",
        formName: "ring_color",
        key: "ringColor",
        labelKey: "admin.settings.theme.colors.ring.label",
      },
    ],
    titleKey: "admin.settings.theme.groups.ui.title",
  },
  {
    descriptionKey: "admin.settings.theme.groups.status.description",
    fields: [
      {
        descriptionKey: "admin.settings.theme.colors.success.description",
        formName: "success_color",
        inlineWithNext: true,
        key: "successColor",
        labelKey: "admin.settings.theme.colors.success.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.success_foreground.description",
        formName: "success_foreground_color",
        key: "successForegroundColor",
        labelKey: "admin.settings.theme.colors.success_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.warning.description",
        formName: "warning_color",
        inlineWithNext: true,
        key: "warningColor",
        labelKey: "admin.settings.theme.colors.warning.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.warning_foreground.description",
        formName: "warning_foreground_color",
        key: "warningForegroundColor",
        labelKey: "admin.settings.theme.colors.warning_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.destructive.description",
        formName: "destructive_color",
        inlineWithNext: true,
        key: "destructiveColor",
        labelKey: "admin.settings.theme.colors.destructive.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.destructive_foreground.description",
        formName: "destructive_foreground_color",
        key: "destructiveForegroundColor",
        labelKey: "admin.settings.theme.colors.destructive_foreground.label",
      },
      {
        descriptionKey: "admin.settings.theme.colors.info.description",
        formName: "info_color",
        inlineWithNext: true,
        key: "infoColor",
        labelKey: "admin.settings.theme.colors.info.label",
      },
      {
        descriptionKey:
          "admin.settings.theme.colors.info_foreground.description",
        formName: "info_foreground_color",
        key: "infoForegroundColor",
        labelKey: "admin.settings.theme.colors.info_foreground.label",
      },
    ],
    titleKey: "admin.settings.theme.groups.status.title",
  },
];

const applyThemePreview = (theme: TenantThemeColors) => {
  if (typeof document === "undefined") {
    return;
  }
  const vars = toPubliraThemeCssVariables(theme);
  const root = document.documentElement;
  for (const [property, value] of Object.entries(vars)) {
    root.style.setProperty(property, value);
  }
};

export const ThemeSettingsForm = ({
  action,
  initialTheme,
}: ThemeSettingsFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const pickerLabel = getMessage(messages, "admin.settings.theme.color_picker");
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [colors, setColors] = useState<TenantThemeColors>(initialTheme);
  const [prevInitialTheme, setPrevInitialTheme] = useState(initialTheme);
  const [prevState, setPrevState] = useState(state);

  if (initialTheme !== prevInitialTheme) {
    setPrevInitialTheme(initialTheme);
    setColors(initialTheme);
  }

  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setColors(state.theme);
    }
  }

  const createHandler = useCallback(
    (key: ColorKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setColors((prev) => {
        const next = { ...prev, [key]: nextValue };
        applyThemePreview(next);
        return next;
      });
    },
    []
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-6">
      <form action={formAction} className="contents">
        <input name="tenant_id" type="hidden" value={tenantId} />

        {colorGroups.map((group) => (
          <Card key={group.titleKey}>
            <CardHeader>
              <CardTitle>{getMessage(messages, group.titleKey)}</CardTitle>
              <CardDescription>
                {getMessage(messages, group.descriptionKey)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-5 sm:max-w-3xl">
                {group.fields.map((field, index) => {
                  if (index > 0 && group.fields[index - 1]?.inlineWithNext) {
                    return null;
                  }

                  if (field.inlineWithNext && group.fields[index + 1]) {
                    const pair = group.fields[index + 1];
                    return (
                      <div
                        className="grid gap-5 md:grid-cols-2"
                        key={`${field.key}-${pair.key}`}
                      >
                        <Field>
                          <FieldLabel required>
                            {getMessage(messages, field.labelKey)}
                          </FieldLabel>
                          <FieldContent>
                            <ColorSwatchInput
                              name={field.formName}
                              onChange={createHandler(field.key)}
                              pickerLabel={pickerLabel}
                              value={colors[field.key]}
                            />
                            {field.descriptionKey ? (
                              <FieldDescription>
                                {getMessage(messages, field.descriptionKey)}
                              </FieldDescription>
                            ) : null}
                            {fieldErrors?.[field.key] ? (
                              <FormMessage variant="destructive">
                                {fieldErrors[field.key]}
                              </FormMessage>
                            ) : null}
                          </FieldContent>
                        </Field>
                        <Field>
                          <FieldLabel required>
                            {getMessage(messages, pair.labelKey)}
                          </FieldLabel>
                          <FieldContent>
                            <ColorSwatchInput
                              name={pair.formName}
                              onChange={createHandler(pair.key)}
                              pickerLabel={pickerLabel}
                              value={colors[pair.key]}
                            />
                            {pair.descriptionKey ? (
                              <FieldDescription>
                                {getMessage(messages, pair.descriptionKey)}
                              </FieldDescription>
                            ) : null}
                            {fieldErrors?.[pair.key] ? (
                              <FormMessage variant="destructive">
                                {fieldErrors[pair.key]}
                              </FormMessage>
                            ) : null}
                          </FieldContent>
                        </Field>
                      </div>
                    );
                  }

                  return (
                    <Field key={field.key}>
                      <FieldLabel required>
                        {getMessage(messages, field.labelKey)}
                      </FieldLabel>
                      <FieldContent>
                        <ColorSwatchInput
                          name={field.formName}
                          onChange={createHandler(field.key)}
                          pickerLabel={pickerLabel}
                          value={colors[field.key]}
                        />
                        {field.descriptionKey ? (
                          <FieldDescription>
                            {getMessage(messages, field.descriptionKey)}
                          </FieldDescription>
                        ) : null}
                        {fieldErrors?.[field.key] ? (
                          <FormMessage variant="destructive">
                            {fieldErrors[field.key]}
                          </FormMessage>
                        ) : null}
                      </FieldContent>
                    </Field>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}

        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}

        <div className="flex justify-end">
          <Button disabled={isPending} type="submit">
            {isPending
              ? getMessage(messages, "admin.settings.saving")
              : getMessage(messages, "admin.settings.theme.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
};
