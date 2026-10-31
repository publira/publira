"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import {
  DEFAULT_TENANT_THEME_COLORS,
  toPubliraThemeCssVariables,
} from "@publira/utils/theme-css-variables";
import type {
  TenantTheme,
  TenantThemeColors,
  TenantThemeFontFamilies,
} from "@publira/utils/theme-css-variables";
import { createContext, use, useId, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

import { deriveDarkPalette } from "../_lib/dark-palette";
import type {
  DarkThemeSettingsActionState,
  ThemeSettingsActionState,
} from "../branding-types";
import { ThemePreviewThemeContext } from "./theme-preview-frame";

type ThemeKey = keyof TenantTheme;

interface ThemeSettingsContextValue {
  theme: TenantTheme;
  setTheme: (update: (theme: TenantTheme) => TenantTheme) => void;
  /**
   * Whether an edit repaints the console itself. Only the light palette does:
   * the console is drawn in light colors, so the dark palette is seen in its
   * preview alone.
   */
  paintsDocument: boolean;
}

/** The palette the fields below it edit: the light one, or the dark one inside `DarkScope`. */
const ThemeSettingsContext = createContext<ThemeSettingsContextValue | null>(
  null
);

interface DarkThemeContextValue {
  darkTheme: TenantThemeColors;
  setDarkTheme: (
    update: (darkTheme: TenantThemeColors) => TenantThemeColors
  ) => void;
  /** The light palette the form holds, which the dark one is derived from. */
  lightTheme: TenantTheme;
}

const DarkThemeContext = createContext<DarkThemeContextValue | null>(null);

const useThemeSettings = () => {
  const context = use(ThemeSettingsContext);

  if (!context) {
    throw new Error("ThemeSettingsScope is required.");
  }

  return context;
};

const useDarkTheme = () => {
  const context = use(DarkThemeContext);

  if (!context) {
    throw new Error("ThemeSettingsScope is required.");
  }

  return context;
};

/** The colors of a theme, without the typefaces the dark palette has none of. */
const pickThemeColors = (theme: TenantThemeColors): TenantThemeColors => {
  const colors = { ...DEFAULT_TENANT_THEME_COLORS };

  for (const key of Object.keys(
    DEFAULT_TENANT_THEME_COLORS
  ) as (keyof TenantThemeColors)[]) {
    colors[key] = theme[key];
  }

  return colors;
};

const applyThemePreview = (theme: TenantTheme) => {
  const vars = toPubliraThemeCssVariables(theme);
  const root = document.documentElement;

  for (const [property, value] of Object.entries(vars)) {
    root.style.setProperty(property, value);
  }
};

/**
 * The palettes the forms hold, shared by their fields and the preview tab, so
 * switching tabs keeps what was typed. Seeded once per mount; a save replaces
 * a palette with the one the server stored.
 *
 * A tenant with no dark palette starts from one derived from its light
 * palette, so the dark fields always have colors to edit.
 */
const ThemeSettingsScope = ({
  children,
  initialDarkTheme,
  initialTheme,
}: {
  children: ReactNode;
  initialDarkTheme: TenantThemeColors | null;
  initialTheme: TenantTheme;
}) => {
  const [theme, setTheme] = useState<TenantTheme>(initialTheme);

  const [darkTheme, setDarkTheme] = useState<TenantThemeColors>(
    () => initialDarkTheme ?? deriveDarkPalette(initialTheme)
  );

  const context = useMemo(
    () => ({ paintsDocument: true, setTheme, theme }),
    [theme]
  );

  const darkContext = useMemo(
    () => ({ darkTheme, lightTheme: theme, setDarkTheme }),
    [darkTheme, theme]
  );

  return (
    <ThemeSettingsContext value={context}>
      <DarkThemeContext value={darkContext}>
        <ThemePreviewThemeContext value={theme}>
          {children}
        </ThemePreviewThemeContext>
      </DarkThemeContext>
    </ThemeSettingsContext>
  );
};

/**
 * Points the fields and the preview below it at the dark palette. The dark
 * palette carries no typefaces of its own, so it is shown in the light
 * palette's.
 */
const DarkThemeScope = ({ children }: { children: ReactNode }) => {
  const { darkTheme, lightTheme, setDarkTheme } = useDarkTheme();
  const { sansFontFamily, serifFontFamily } = lightTheme;

  const context = useMemo(() => {
    const withTypefaces = (colors: TenantThemeColors): TenantTheme => ({
      ...colors,
      sansFontFamily,
      serifFontFamily,
    });

    return {
      paintsDocument: false,
      setTheme: (update: (theme: TenantTheme) => TenantTheme) => {
        setDarkTheme((previous) =>
          pickThemeColors(update(withTypefaces(previous)))
        );
      },
      theme: withTypefaces(darkTheme),
    };
  }, [darkTheme, sansFontFamily, serifFontFamily, setDarkTheme]);

  return (
    <ThemeSettingsContext value={context}>
      <ThemePreviewThemeContext value={context.theme}>
        {children}
      </ThemePreviewThemeContext>
    </ThemeSettingsContext>
  );
};

/** Adopts the palette a save stored, normalization included, so the fields show what a reload would. */
const ThemeSettingsSaved = () => {
  const { setTheme } = useThemeSettings();
  ActionForm.useSettled<NonNullable<ThemeSettingsActionState>>((state) => {
    if (state?.ok) {
      setTheme(() => state.theme);
    }
  });

  return null;
};

/**
 * Adopts the dark palette a save stored, or, once a delete leaves none, the one
 * derived from the light palette that a tenant without one starts from.
 */
const DarkThemeSettingsSaved = () => {
  const { lightTheme, setDarkTheme } = useDarkTheme();
  ActionForm.useSettled<NonNullable<DarkThemeSettingsActionState>>((state) => {
    if (state?.ok) {
      setDarkTheme(() => state.darkTheme ?? deriveDarkPalette(lightTheme));
    }
  });

  return null;
};

/** Replaces every dark color with the one derived from the light palette the form holds. */
const DeriveDarkThemeFromLight = ({ children }: { children: ReactNode }) => {
  const { lightTheme, setDarkTheme } = useDarkTheme();

  return (
    <Button
      onClick={() => {
        setDarkTheme(() => deriveDarkPalette(lightTheme));
      }}
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
};

const useThemeField = (field: ThemeKey) => {
  const { paintsDocument, setTheme, theme } = useThemeSettings();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setTheme((previous) => {
      const next = { ...previous, [field]: nextValue };

      if (paintsDocument) {
        applyThemePreview(next);
      }

      return next;
    });
  };

  return { onChange, value: theme[field] };
};

/** A color of the palette, typed as `#RRGGBB` or picked from the swatch. */
const ThemeSettingsColorInput = ({
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
const ThemeSettingsFontFamilyInput = ({
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

export {
  ThemeSettingsScope as Root,
  ThemeSettingsColorInput as ColorInput,
  ThemeSettingsFontFamilyInput as FontFamilyInput,
  ThemeSettingsSaved as Saved,
  DarkThemeScope as DarkScope,
  DarkThemeSettingsSaved as DarkSaved,
  DeriveDarkThemeFromLight as DeriveFromLight,
};
