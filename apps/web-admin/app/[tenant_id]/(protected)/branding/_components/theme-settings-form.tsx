import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
import { DEFAULT_TENANT_THEME_FONT_FAMILIES } from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
} from "@publira/utils/theme-css-variables";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import { updateTenantThemeSettingsAction } from "../_lib/actions";
import { ThemePreview } from "./theme-preview";
import {
  ThemeColorInput,
  ThemeFontFamilyInput,
  ThemeSettingsSaved,
  ThemeSettingsScope,
} from "./theme-settings-fields";

interface ThemeSettingsFormProps {
  initialTheme: TenantTheme;
  tenantId: string;
}

/**
 * A color field's control: the swatch for `field`, the description the caller
 * writes as `children`, and the error the Action returned for that field.
 */
const ThemeColorControl = ({
  children,
  field,
  name,
}: {
  children: ReactNode;
  field: keyof TenantThemeColors;
  name: string;
}) => (
  <FieldContent>
    <ThemeColorInput field={field} name={name} />
    {children}
    <ActionFormFieldError name={field} />
  </FieldContent>
);

export const ThemeSettingsForm = ({
  initialTheme,
  tenantId,
}: ThemeSettingsFormProps) => (
  <ThemeSettingsScope initialTheme={initialTheme}>
    <Tabs defaultValue="edit">
      <TabsList>
        <TabsTab value="edit">
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="admin.settings.theme.tabs.edit" />
          </Suspense>
        </TabsTab>
        <TabsTab value="preview">
          <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
            <Message message="admin.settings.theme.tabs.preview" />
          </Suspense>
        </TabsTab>
      </TabsList>

      <TabsPanel value="edit">
        <AdminSections>
          <ActionForm
            action={updateTenantThemeSettingsAction}
            className="contents"
          >
            <input name="tenant_id" type="hidden" value={tenantId} />
            <ThemeSettingsSaved />

            <ActionFormFieldset className="contents">
              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.title" />
                      </Suspense>
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.typefaces.description" />
                      </Suspense>
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.serif.label" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <ThemeFontFamilyInput
                        field="serifFontFamily"
                        name="serif_font_family"
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.serifFontFamily
                        }
                      />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.typefaces.serif.description" />
                        </Suspense>
                      </FieldDescription>
                      <ActionFormFieldError name="serifFontFamily" />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.sans.label" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <ThemeFontFamilyInput
                        field="sansFontFamily"
                        name="sans_font_family"
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.sansFontFamily
                        }
                      />
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.typefaces.sans.description" />
                        </Suspense>
                      </FieldDescription>
                      <ActionFormFieldError name="sansFontFamily" />
                    </FieldContent>
                  </Field>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.brand.title" />
                      </Suspense>
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.brand.description" />
                      </Suspense>
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.primary.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="primaryColor"
                        name="primary_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.primary.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.primary_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="primaryForegroundColor"
                        name="primary_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.primary_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.secondary.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="secondaryColor"
                        name="secondary_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.secondary.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.secondary_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="secondaryForegroundColor"
                        name="secondary_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.secondary_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.accent.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="accentColor"
                        name="accent_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.accent.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.accent_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="accentForegroundColor"
                        name="accent_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.accent_foreground.description" />
                          </Suspense>
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
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.surface.title" />
                      </Suspense>
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.surface.description" />
                      </Suspense>
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.background.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="backgroundColor"
                        name="background_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.background.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="foregroundColor"
                        name="foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.surface.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="surfaceColor"
                        name="surface_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.surface.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.surface_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="surfaceForegroundColor"
                        name="surface_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.surface_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.card.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl field="cardColor" name="card_color">
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.card.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.card_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="cardForegroundColor"
                        name="card_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.card_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.popover.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="popoverColor"
                        name="popover_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.popover.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.popover_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="popoverForegroundColor"
                        name="popover_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.popover_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.muted.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl field="mutedColor" name="muted_color">
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.muted.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.muted_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="mutedForegroundColor"
                        name="muted_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.muted_foreground.description" />
                          </Suspense>
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
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.ui.title" />
                      </Suspense>
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.ui.description" />
                      </Suspense>
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field>
                    <FieldLabel required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.border.label" />
                      </Suspense>
                    </FieldLabel>
                    <ThemeColorControl field="borderColor" name="border_color">
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.border.description" />
                        </Suspense>
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                  <Field>
                    <FieldLabel required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.input.label" />
                      </Suspense>
                    </FieldLabel>
                    <ThemeColorControl field="inputColor" name="input_color">
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.input.description" />
                        </Suspense>
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                  <Field>
                    <FieldLabel required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.ring.label" />
                      </Suspense>
                    </FieldLabel>
                    <ThemeColorControl field="ringColor" name="ring_color">
                      <FieldDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.ring.description" />
                        </Suspense>
                      </FieldDescription>
                    </ThemeColorControl>
                  </Field>
                </div>
              </AdminSection>

              <AdminSection>
                <AdminSectionHeader>
                  <AdminSectionHeading>
                    <AdminSectionTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.status.title" />
                      </Suspense>
                    </AdminSectionTitle>
                    <AdminSectionDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.status.description" />
                      </Suspense>
                    </AdminSectionDescription>
                  </AdminSectionHeading>
                </AdminSectionHeader>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.success.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="successColor"
                        name="success_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.success.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.success_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="successForegroundColor"
                        name="success_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.success_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.warning.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="warningColor"
                        name="warning_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.warning.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.warning_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="warningForegroundColor"
                        name="warning_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.warning_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.destructive.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="destructiveColor"
                        name="destructive_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.destructive.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.destructive_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="destructiveForegroundColor"
                        name="destructive_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.destructive_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.info.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl field="infoColor" name="info_color">
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.info.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                    <Field>
                      <FieldLabel required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.info_foreground.label" />
                        </Suspense>
                      </FieldLabel>
                      <ThemeColorControl
                        field="infoForegroundColor"
                        name="info_foreground_color"
                      >
                        <FieldDescription>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.info_foreground.description" />
                          </Suspense>
                        </FieldDescription>
                      </ThemeColorControl>
                    </Field>
                  </div>
                </div>
              </AdminSection>
            </ActionFormFieldset>

            <div className="flex justify-end">
              <ActionFormSubmit>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <ActionFormIdle>
                    <Message message="admin.settings.theme.submit" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <Message message="admin.settings.saving" />
                  </ActionFormPending>
                </Suspense>
              </ActionFormSubmit>
            </div>
          </ActionForm>
        </AdminSections>
      </TabsPanel>

      <TabsPanel value="preview">
        <AdminSection>
          <AdminSectionHeader>
            <AdminSectionHeading>
              <AdminSectionTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                  <Message message="admin.settings.theme.preview.title" />
                </Suspense>
              </AdminSectionTitle>
              <AdminSectionDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                  <Message message="admin.settings.theme.preview.description" />
                </Suspense>
              </AdminSectionDescription>
            </AdminSectionHeading>
          </AdminSectionHeader>
          <ThemePreview />
        </AdminSection>
      </TabsPanel>
    </Tabs>
  </ThemeSettingsScope>
);
