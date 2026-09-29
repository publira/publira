"use client";

import { useActionFormSettled } from "@publira/ui-components/action-form";
import { Input } from "@publira/ui-components/input";
import { toPubliraThemeCssVariables } from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
  TenantThemeFontFamilies,
} from "@publira/utils/theme-css-variables";
import { createContext, use, useId, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

import type { ThemeSettingsActionState } from "../branding-types";
import { ThemePreviewThemeContext } from "./theme-preview-frame";

type ThemeKey = keyof TenantTheme;

interface ThemeSettingsContextValue {
  theme: TenantTheme;
  setTheme: (update: (theme: TenantTheme) => TenantTheme) => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(
  null
);

const useThemeSettings = () => {
  const context = use(ThemeSettingsContext);
  if (!context) {
    throw new Error("ThemeSettingsScope is required.");
  }

  return context;
};

const applyThemePreview = (theme: TenantTheme) => {
  const vars = toPubliraThemeCssVariables(theme);
  const root = document.documentElement;
  for (const [property, value] of Object.entries(vars)) {
    root.style.setProperty(property, value);
  }
};

/**
 * The palette the form holds, shared by its fields and the preview tab. Seeded
 * once per mount; a save replaces it with the palette the server stored.
 */
export const ThemeSettingsScope = ({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme: TenantTheme;
}) => {
  const [theme, setTheme] = useState<TenantTheme>(initialTheme);
  const context = useMemo(() => ({ setTheme, theme }), [theme]);

  return (
    <ThemeSettingsContext value={context}>
      <ThemePreviewThemeContext value={theme}>
        {children}
      </ThemePreviewThemeContext>
    </ThemeSettingsContext>
  );
};

/** Adopts the palette a save stored, normalization included, so the fields show what a reload would. */
export const ThemeSettingsSaved = () => {
  const { setTheme } = useThemeSettings();
  useActionFormSettled<NonNullable<ThemeSettingsActionState>>((state) => {
    if (state?.ok) {
      setTheme(() => state.theme);
    }
  });

  return null;
};

const useThemeField = (field: ThemeKey) => {
  const { setTheme, theme } = useThemeSettings();
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setTheme((previous) => {
      const next = { ...previous, [field]: nextValue };
      applyThemePreview(next);
      return next;
    });
  };

  return { onChange, value: theme[field] };
};

/** A color of the palette, typed as `#RRGGBB` or picked from the swatch. */
export const ThemeColorInput = ({
  field,
  name,
}: {
  field: keyof TenantThemeColors;
  name: string;
}) => {
  const t = useClientMessages();
  const pickerId = useId();
  const { onChange, value } = useThemeField(field);

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

/** A CSS font stack of the palette; the placeholder is the stack an empty value falls back to. */
export const ThemeFontFamilyInput = ({
  field,
  name,
  placeholder,
}: {
  field: keyof TenantThemeFontFamilies;
  name: string;
  placeholder: string;
}) => {
  const { onChange, value } = useThemeField(field);

  return (
    <Input
      maxLength={512}
      name={name}
      onChange={onChange}
      placeholder={placeholder}
      type="text"
      value={value}
    />
  );
};
