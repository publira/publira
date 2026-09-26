"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
import {
  DEFAULT_TENANT_THEME_FONT_FAMILIES,
  toPubliraThemeCssVariables,
} from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
  TenantThemeFontFamilies,
} from "@publira/utils/theme-css-variables";
import { useActionState, useCallback, useId, useState } from "react";
import type { ReactNode } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import type {
  ThemeSettingsActionState,
  ThemeSettingsFieldErrors,
} from "../branding-types";
import { ThemePreviewThemeContext } from "./theme-preview-frame";

interface ThemeSettingsFormProps {
  action: (
    prevState: ThemeSettingsActionState,
    formData: FormData
  ) => Promise<ThemeSettingsActionState>;
  initialTheme: TenantTheme;
  /** `ThemePreview`, painted from the colors this form currently holds. */
  preview: ReactNode;
}

interface ColorSwatchInputProps {
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const ColorSwatchInput = ({ name, value, onChange }: ColorSwatchInputProps) => {
  const t = useClientMessages();
  const pickerId = useId();
  return (
    <div className="relative flex max-w-48 items-center">
      <label
        aria-label={t("admin.settings.theme.color_picker")}
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
type FontFamilyKey = keyof TenantThemeFontFamilies;

/**
 * A color field's control: the swatch for `field`, the description the caller
 * writes as `children`, and the error the Action returned for that field.
 */
const ThemeColorControl = ({
  children,
  errors,
  field,
  name,
  onChange,
  theme,
}: {
  children: ReactNode;
  errors: ThemeSettingsFieldErrors | undefined;
  field: ColorKey;
  name: string;
  onChange: ColorSwatchInputProps["onChange"];
  theme: TenantTheme;
}) => {
  const error = errors?.[field];

  return (
    <FieldContent>
      <ColorSwatchInput name={name} onChange={onChange} value={theme[field]} />
      {children}
      {error ? <FormMessage variant="destructive">{error}</FormMessage> : null}
    </FieldContent>
  );
};

const applyThemePreview = (theme: TenantTheme) => {
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
  preview,
}: ThemeSettingsFormProps) => {
  const tenantId = useTenantId();
  // Seeded once per mount; submitting is what replaces it, with the palette the
  // server stored — normalization included, so the pickers show what a reload
  // would show.
  const [theme, setTheme] = useState<TenantTheme>(initialTheme);
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: ThemeSettingsActionState,
      formData: FormData
    ): Promise<ThemeSettingsActionState> => {
      const nextState = await action(previousState, formData);
      if (nextState?.ok) {
        setTheme(nextState.theme);
      }
      return nextState;
    },
    null
  );

  const createHandler = useCallback(
    (key: ColorKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setTheme((prev) => {
        const next = { ...prev, [key]: nextValue };
        applyThemePreview(next);
        return next;
      });
    },
    []
  );

  const createFontFamilyHandler = useCallback(
    (key: FontFamilyKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setTheme((prev) => {
        const next = { ...prev, [key]: nextValue };
        applyThemePreview(next);
        return next;
      });
    },
    []
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <Tabs defaultValue="edit">
      <TabsList>
        <TabsTab value="edit">
          <ClientMessage message="admin.settings.theme.tabs.edit" />
        </TabsTab>
        <TabsTab value="preview">
          <ClientMessage message="admin.settings.theme.tabs.preview" />
        </TabsTab>
      </TabsList>

      <TabsPanel value="edit">
        <AdminSections>
          <form action={formAction} className="contents">
            <input name="tenant_id" type="hidden" value={tenantId} />

            <Fieldset className="contents" disabled={isPending}>
              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <ClientMessage message="admin.settings.theme.typefaces.title" />
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <ClientMessage message="admin.settings.theme.typefaces.description" />
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field>
                    <FieldLabel>
                      <ClientMessage message="admin.settings.theme.typefaces.serif.label" />
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        maxLength={512}
                        name="serif_font_family"
                        onChange={createFontFamilyHandler("serifFontFamily")}
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.serifFontFamily
                        }
                        type="text"
                        value={theme.serifFontFamily}
                      />
                      <FieldDescription>
                        <ClientMessage message="admin.settings.theme.typefaces.serif.description" />
                      </FieldDescription>
                      {fieldErrors?.serifFontFamily ? (
                        <FormMessage variant="destructive">
                          {fieldErrors.serifFontFamily}
                        </FormMessage>
                      ) : null}
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>
                      <ClientMessage message="admin.settings.theme.typefaces.sans.label" />
                    </FieldLabel>
                    <FieldContent>
                      <Input
                        maxLength={512}
                        name="sans_font_family"
                        onChange={createFontFamilyHandler("sansFontFamily")}
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.sansFontFamily
                        }
                        type="text"
                        value={theme.sansFontFamily}
                      />
                      <FieldDescription>
                        <ClientMessage message="admin.settings.theme.typefaces.sans.description" />
                      </FieldDescription>
                      {fieldErrors?.sansFontFamily ? (
                        <FormMessage variant="destructive">
                          {fieldErrors.sansFontFamily}
                        </FormMessage>
                      ) : null}
                    </FieldContent>
                  </Field>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <ClientMessage message="admin.settings.theme.groups.brand.title" />
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <ClientMessage message="admin.settings.theme.groups.brand.description" />
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.primary.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="primaryColor"
                        name="primary_color"
                        onChange={createHandler("primaryColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.primary.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.primary_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="primaryForegroundColor"
                        name="primary_foreground_color"
                        onChange={createHandler("primaryForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.primary_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.secondary.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="secondaryColor"
                        name="secondary_color"
                        onChange={createHandler("secondaryColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.secondary.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.secondary_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="secondaryForegroundColor"
                        name="secondary_foreground_color"
                        onChange={createHandler("secondaryForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.secondary_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.accent.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="accentColor"
                        name="accent_color"
                        onChange={createHandler("accentColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.accent.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.accent_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="accentForegroundColor"
                        name="accent_foreground_color"
                        onChange={createHandler("accentForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.accent_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <ClientMessage message="admin.settings.theme.groups.surface.title" />
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <ClientMessage message="admin.settings.theme.groups.surface.description" />
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.background.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="backgroundColor"
                        name="background_color"
                        onChange={createHandler("backgroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.background.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="foregroundColor"
                        name="foreground_color"
                        onChange={createHandler("foregroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.surface.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="surfaceColor"
                        name="surface_color"
                        onChange={createHandler("surfaceColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.surface.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.surface_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="surfaceForegroundColor"
                        name="surface_foreground_color"
                        onChange={createHandler("surfaceForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.surface_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.card.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="cardColor"
                        name="card_color"
                        onChange={createHandler("cardColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.card.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.card_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="cardForegroundColor"
                        name="card_foreground_color"
                        onChange={createHandler("cardForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.card_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.popover.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="popoverColor"
                        name="popover_color"
                        onChange={createHandler("popoverColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.popover.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.popover_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="popoverForegroundColor"
                        name="popover_foreground_color"
                        onChange={createHandler("popoverForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.popover_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.muted.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="mutedColor"
                        name="muted_color"
                        onChange={createHandler("mutedColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.muted.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.muted_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="mutedForegroundColor"
                        name="muted_foreground_color"
                        onChange={createHandler("mutedForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.muted_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <ClientMessage message="admin.settings.theme.groups.ui.title" />
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <ClientMessage message="admin.settings.theme.groups.ui.description" />
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field>
                    <FieldLabel required>
                      <ClientMessage message="admin.settings.theme.colors.border.label" />
                    </FieldLabel>
                    <ThemeColorControl
                      errors={fieldErrors}
                      field="borderColor"
                      name="border_color"
                      onChange={createHandler("borderColor")}
                      theme={theme}
                    >
                      <FieldDescription>
                        <ClientMessage message="admin.settings.theme.colors.border.description" />
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                  <Field>
                    <FieldLabel required>
                      <ClientMessage message="admin.settings.theme.colors.input.label" />
                    </FieldLabel>
                    <ThemeColorControl
                      errors={fieldErrors}
                      field="inputColor"
                      name="input_color"
                      onChange={createHandler("inputColor")}
                      theme={theme}
                    >
                      <FieldDescription>
                        <ClientMessage message="admin.settings.theme.colors.input.description" />
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                  <Field>
                    <FieldLabel required>
                      <ClientMessage message="admin.settings.theme.colors.ring.label" />
                    </FieldLabel>
                    <ThemeColorControl
                      errors={fieldErrors}
                      field="ringColor"
                      name="ring_color"
                      onChange={createHandler("ringColor")}
                      theme={theme}
                    >
                      <FieldDescription>
                        <ClientMessage message="admin.settings.theme.colors.ring.description" />
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <ClientMessage message="admin.settings.theme.groups.status.title" />
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <ClientMessage message="admin.settings.theme.groups.status.description" />
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.success.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="successColor"
                        name="success_color"
                        onChange={createHandler("successColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.success.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.success_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="successForegroundColor"
                        name="success_foreground_color"
                        onChange={createHandler("successForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.success_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.warning.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="warningColor"
                        name="warning_color"
                        onChange={createHandler("warningColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.warning.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.warning_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="warningForegroundColor"
                        name="warning_foreground_color"
                        onChange={createHandler("warningForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.warning_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.destructive.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="destructiveColor"
                        name="destructive_color"
                        onChange={createHandler("destructiveColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.destructive.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.destructive_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="destructiveForegroundColor"
                        name="destructive_foreground_color"
                        onChange={createHandler("destructiveForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.destructive_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.info.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="infoColor"
                        name="info_color"
                        onChange={createHandler("infoColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.info.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <ClientMessage message="admin.settings.theme.colors.info_foreground.label" />
                      </FieldLabel>
                      <ThemeColorControl
                        errors={fieldErrors}
                        field="infoForegroundColor"
                        name="info_foreground_color"
                        onChange={createHandler("infoForegroundColor")}
                        theme={theme}
                      >
                        <FieldDescription>
                          <ClientMessage message="admin.settings.theme.colors.info_foreground.description" />
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                </div>
              </AdminSection>
            </Fieldset>

            {state ? (
              <FormMessage variant={state.ok ? "success" : "destructive"}>
                {state.message}
              </FormMessage>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={isPending} type="submit">
                <ActionFormIdle>
                  <ClientMessage message="admin.settings.theme.submit" />
                </ActionFormIdle>
                <ActionFormPending>
                  <ClientMessage message="admin.settings.saving" />
                </ActionFormPending>
              </Button>
            </div>
          </form>
        </AdminSections>
      </TabsPanel>

      <TabsPanel value="preview">
        <AdminSection>
          <AdminSectionHeader>
            <AdminSectionHeading>
              <AdminSectionTitle>
                <ClientMessage message="admin.settings.theme.preview.title" />
              </AdminSectionTitle>
              <AdminSectionDescription>
                <ClientMessage message="admin.settings.theme.preview.description" />
              </AdminSectionDescription>
            </AdminSectionHeading>
          </AdminSectionHeader>
          <ThemePreviewThemeContext value={theme}>
            {preview}
          </ThemePreviewThemeContext>
        </AdminSection>
      </TabsPanel>
    </Tabs>
  );
};
