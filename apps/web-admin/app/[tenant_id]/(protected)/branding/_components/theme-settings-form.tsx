import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Tabs from "@publira/ui-components/tabs";
import { DEFAULT_TENANT_THEME_FONT_FAMILIES } from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
} from "@publira/utils/theme-css-variables";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

import { updateTenantThemeSettingsAction } from "../_lib/actions";
import { ThemePreview } from "./theme-preview";
import * as ThemeSettings from "./theme-settings-fields";

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
  <Field.Content>
    <ThemeSettings.ColorInput field={field} name={name} />
    {children}
    <ActionForm.FieldError name={field} />
  </Field.Content>
);

export const ThemeSettingsForm = ({
  initialTheme,
  tenantId,
}: ThemeSettingsFormProps) => (
  <ThemeSettings.Root initialTheme={initialTheme}>
    <Tabs.Root defaultValue="edit">
      <Tabs.List>
        <Tabs.Tab value="edit">
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="admin.settings.theme.tabs.edit" />
          </Suspense>
        </Tabs.Tab>
        <Tabs.Tab value="preview">
          <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
            <Message message="admin.settings.theme.tabs.preview" />
          </Suspense>
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="edit">
        <ConsoleSection.Stack>
          <ActionForm.Root
            action={updateTenantThemeSettingsAction}
            className="contents"
          >
            <input name="tenant_id" type="hidden" value={tenantId} />
            <ThemeSettings.Saved />

            <ActionForm.Fieldset className="contents">
              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.typefaces.description" />
                      </Suspense>
                    </ConsoleSection.Description>
                  </ConsoleSection.Heading>
                </ConsoleSection.Header>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.serif.label" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <ThemeSettings.FontFamilyInput
                        field="serifFontFamily"
                        name="serif_font_family"
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.serifFontFamily
                        }
                      />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.typefaces.serif.description" />
                        </Suspense>
                      </Field.Description>
                      <ActionForm.FieldError name="serifFontFamily" />
                    </Field.Content>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="admin.settings.theme.typefaces.sans.label" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <ThemeSettings.FontFamilyInput
                        field="sansFontFamily"
                        name="sans_font_family"
                        placeholder={
                          DEFAULT_TENANT_THEME_FONT_FAMILIES.sansFontFamily
                        }
                      />
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.typefaces.sans.description" />
                        </Suspense>
                      </Field.Description>
                      <ActionForm.FieldError name="sansFontFamily" />
                    </Field.Content>
                  </Field.Root>
                </div>
              </ConsoleSection.Root>

              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.brand.title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.brand.description" />
                      </Suspense>
                    </ConsoleSection.Description>
                  </ConsoleSection.Heading>
                </ConsoleSection.Header>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.primary.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="primaryColor"
                        name="primary_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.primary.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.primary_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="primaryForegroundColor"
                        name="primary_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.primary_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.secondary.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="secondaryColor"
                        name="secondary_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.secondary.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.secondary_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="secondaryForegroundColor"
                        name="secondary_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.secondary_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.accent.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="accentColor"
                        name="accent_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.accent.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.accent_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="accentForegroundColor"
                        name="accent_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.accent_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                </div>
              </ConsoleSection.Root>

              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.surface.title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.surface.description" />
                      </Suspense>
                    </ConsoleSection.Description>
                  </ConsoleSection.Heading>
                </ConsoleSection.Header>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.background.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="backgroundColor"
                        name="background_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.background.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="foregroundColor"
                        name="foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.surface.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="surfaceColor"
                        name="surface_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.surface.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.surface_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="surfaceForegroundColor"
                        name="surface_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.surface_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.card.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl field="cardColor" name="card_color">
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.card.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.card_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="cardForegroundColor"
                        name="card_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.card_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.popover.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="popoverColor"
                        name="popover_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.popover.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.popover_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="popoverForegroundColor"
                        name="popover_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.popover_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.muted.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl field="mutedColor" name="muted_color">
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.muted.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.muted_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="mutedForegroundColor"
                        name="muted_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.muted_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                </div>
              </ConsoleSection.Root>

              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.ui.title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.ui.description" />
                      </Suspense>
                    </ConsoleSection.Description>
                  </ConsoleSection.Heading>
                </ConsoleSection.Header>
                <div className="grid gap-5 sm:max-w-3xl">
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.border.label" />
                      </Suspense>
                    </Field.Label>
                    <ThemeColorControl field="borderColor" name="border_color">
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.border.description" />
                        </Suspense>
                      </Field.Description>
                    </ThemeColorControl>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.input.label" />
                      </Suspense>
                    </Field.Label>
                    <ThemeColorControl field="inputColor" name="input_color">
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.input.description" />
                        </Suspense>
                      </Field.Description>
                    </ThemeColorControl>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <Message message="admin.settings.theme.colors.ring.label" />
                      </Suspense>
                    </Field.Label>
                    <ThemeColorControl field="ringColor" name="ring_color">
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-3/4" />}
                        >
                          <Message message="admin.settings.theme.colors.ring.description" />
                        </Suspense>
                      </Field.Description>
                    </ThemeColorControl>
                  </Field.Root>
                </div>
              </ConsoleSection.Root>

              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-40" />}
                      >
                        <Message message="admin.settings.theme.groups.status.title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-80" />}
                      >
                        <Message message="admin.settings.theme.groups.status.description" />
                      </Suspense>
                    </ConsoleSection.Description>
                  </ConsoleSection.Heading>
                </ConsoleSection.Header>
                <div className="grid gap-5 sm:max-w-3xl">
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.success.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="successColor"
                        name="success_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.success.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.success_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="successForegroundColor"
                        name="success_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.success_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.warning.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="warningColor"
                        name="warning_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.warning.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.warning_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="warningForegroundColor"
                        name="warning_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.warning_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.destructive.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="destructiveColor"
                        name="destructive_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.destructive.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.destructive_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="destructiveForegroundColor"
                        name="destructive_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.destructive_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.info.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl field="infoColor" name="info_color">
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.info.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-28" />}
                        >
                          <Message message="admin.settings.theme.colors.info_foreground.label" />
                        </Suspense>
                      </Field.Label>
                      <ThemeColorControl
                        field="infoForegroundColor"
                        name="info_foreground_color"
                      >
                        <Field.Description>
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-3/4" />}
                          >
                            <Message message="admin.settings.theme.colors.info_foreground.description" />
                          </Suspense>
                        </Field.Description>
                      </ThemeColorControl>
                    </Field.Root>
                  </div>
                </div>
              </ConsoleSection.Root>
            </ActionForm.Fieldset>

            <div className="flex justify-end">
              <ActionForm.Submit>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <ActionForm.Idle>
                    <Message message="admin.settings.theme.submit" />
                  </ActionForm.Idle>
                  <ActionForm.Pending>
                    <Message message="admin.settings.saving" />
                  </ActionForm.Pending>
                </Suspense>
              </ActionForm.Submit>
            </div>
          </ActionForm.Root>
        </ConsoleSection.Stack>
      </Tabs.Panel>

      <Tabs.Panel value="preview">
        <ConsoleSection.Root>
          <ConsoleSection.Header>
            <ConsoleSection.Heading>
              <ConsoleSection.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                  <Message message="admin.settings.theme.preview.title" />
                </Suspense>
              </ConsoleSection.Title>
              <ConsoleSection.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                  <Message message="admin.settings.theme.preview.description" />
                </Suspense>
              </ConsoleSection.Description>
            </ConsoleSection.Heading>
          </ConsoleSection.Header>
          <ThemePreview />
        </ConsoleSection.Root>
      </Tabs.Panel>
    </Tabs.Root>
  </ThemeSettings.Root>
);
