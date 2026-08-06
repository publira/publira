"use client";

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
import { useActionState, useCallback, useId, useState } from "react";

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
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const ColorSwatchInput = ({
  id,
  name,
  value,
  onChange,
}: ColorSwatchInputProps) => {
  const pickerId = useId();
  return (
    <div className="relative flex max-w-48 items-center">
      <label
        aria-label="カラーピッカー"
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
        id={id}
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
  label: string;
  description?: string;
  inlineWithNext?: boolean;
}

const colorGroups: {
  title: string;
  description: string;
  fields: ColorFieldConfig[];
}[] = [
  {
    description: "ブランドを表す主要なカラーです。",
    fields: [
      {
        description: "主にボタンや強調要素で利用する基準カラーです。",
        formName: "primary_color",
        inlineWithNext: true,
        key: "primaryColor",
        label: "プライマリーカラー",
      },
      {
        description: "プライマリーカラー上に表示するテキストカラーです。",
        formName: "primary_foreground_color",
        key: "primaryForegroundColor",
        label: "プライマリーテキストカラー",
      },
      {
        description: "補助的なボタンや要素に使用するカラーです。",
        formName: "secondary_color",
        inlineWithNext: true,
        key: "secondaryColor",
        label: "セカンダリーカラー",
      },
      {
        description: "セカンダリーカラー上に表示するテキストカラーです。",
        formName: "secondary_foreground_color",
        key: "secondaryForegroundColor",
        label: "セカンダリーテキストカラー",
      },
      {
        description: "通知や装飾のアクセントに利用するカラーです。",
        formName: "accent_color",
        inlineWithNext: true,
        key: "accentColor",
        label: "アクセントカラー",
      },
      {
        description: "アクセントカラー上に表示するテキストカラーです。",
        formName: "accent_foreground_color",
        key: "accentForegroundColor",
        label: "アクセントテキストカラー",
      },
    ],
    title: "ブランドカラー",
  },
  {
    description: "背景系のカラーとテキストカラーを設定します。",
    fields: [
      {
        description: "ページ全体の基準となる背景カラーです。",
        formName: "background_color",
        inlineWithNext: true,
        key: "backgroundColor",
        label: "デフォルトカラー",
      },
      {
        description: "デフォルトカラー上に表示するテキストカラーです。",
        formName: "foreground_color",
        key: "foregroundColor",
        label: "テキストカラー",
      },
      {
        description: "コンテンツエリアの表面カラーです。",
        formName: "surface_color",
        inlineWithNext: true,
        key: "surfaceColor",
        label: "サーフェースカラー",
      },
      {
        description: "サーフェースカラー上に表示するテキストカラーです。",
        formName: "surface_foreground_color",
        key: "surfaceForegroundColor",
        label: "サーフェーステキストカラー",
      },
      {
        description: "カードコンポーネントの背景カラーです。",
        formName: "card_color",
        inlineWithNext: true,
        key: "cardColor",
        label: "カードカラー",
      },
      {
        description: "カードカラー上に表示するテキストカラーです。",
        formName: "card_foreground_color",
        key: "cardForegroundColor",
        label: "カードテキストカラー",
      },
      {
        description: "ポップオーバーやドロップダウンの背景カラーです。",
        formName: "popover_color",
        inlineWithNext: true,
        key: "popoverColor",
        label: "ポップオーバーカラー",
      },
      {
        description: "ポップオーバーカラー上に表示するテキストカラーです。",
        formName: "popover_foreground_color",
        key: "popoverForegroundColor",
        label: "ポップオーバーテキストカラー",
      },
      {
        description: "控えめな背景や無効化された要素に使用するカラーです。",
        formName: "muted_color",
        inlineWithNext: true,
        key: "mutedColor",
        label: "ミュートカラー",
      },
      {
        description: "ミュート領域上に表示するテキストカラーです。",
        formName: "muted_foreground_color",
        key: "mutedForegroundColor",
        label: "ミュートテキストカラー",
      },
    ],
    title: "背景・テキストカラー",
  },
  {
    description: "ボーダーや入力欄など UI 要素に使用するカラーを設定します。",
    fields: [
      {
        description: "テーブルや枠線に使用するボーダーカラーです。",
        formName: "border_color",
        key: "borderColor",
        label: "ボーダーカラー",
      },
      {
        description: "フォーム入力要素の背景カラーです。",
        formName: "input_color",
        key: "inputColor",
        label: "入力フィールドカラー",
      },
      {
        description: "フォーカス時に表示されるリングカラーです。",
        formName: "ring_color",
        key: "ringColor",
        label: "フォーカスリングカラー",
      },
    ],
    title: "UI要素カラー",
  },
  {
    description:
      "成功・警告・エラー・情報など通知に使用するカラーを設定します。",
    fields: [
      {
        description: "成功メッセージや操作完了を示すカラーです。",
        formName: "success_color",
        inlineWithNext: true,
        key: "successColor",
        label: "成功カラー",
      },
      {
        description: "成功表示上に表示するテキストカラーです。",
        formName: "success_foreground_color",
        key: "successForegroundColor",
        label: "成功テキストカラー",
      },
      {
        description: "警告メッセージを示すカラーです。",
        formName: "warning_color",
        inlineWithNext: true,
        key: "warningColor",
        label: "警告カラー",
      },
      {
        description: "警告表示上に表示するテキストカラーです。",
        formName: "warning_foreground_color",
        key: "warningForegroundColor",
        label: "警告テキストカラー",
      },
      {
        description: "削除やエラー操作を示すカラーです。",
        formName: "destructive_color",
        inlineWithNext: true,
        key: "destructiveColor",
        label: "危険カラー",
      },
      {
        description: "危険表示上に表示するテキストカラーです。",
        formName: "destructive_foreground_color",
        key: "destructiveForegroundColor",
        label: "危険テキストカラー",
      },
      {
        description: "情報メッセージを示すカラーです。",
        formName: "info_color",
        inlineWithNext: true,
        key: "infoColor",
        label: "情報カラー",
      },
      {
        description: "情報表示上に表示するテキストカラーです。",
        formName: "info_foreground_color",
        key: "infoForegroundColor",
        label: "情報テキストカラー",
      },
    ],
    title: "ステータスカラー",
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
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
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
                          <FieldLabel htmlFor={field.formName} required>
                            {field.label}
                          </FieldLabel>
                          <FieldContent>
                            <ColorSwatchInput
                              id={field.formName}
                              name={field.formName}
                              onChange={createHandler(field.key)}
                              value={colors[field.key]}
                            />
                            {field.description ? (
                              <FieldDescription>
                                {field.description}
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
                          <FieldLabel htmlFor={pair.formName} required>
                            {pair.label}
                          </FieldLabel>
                          <FieldContent>
                            <ColorSwatchInput
                              id={pair.formName}
                              name={pair.formName}
                              onChange={createHandler(pair.key)}
                              value={colors[pair.key]}
                            />
                            {pair.description ? (
                              <FieldDescription>
                                {pair.description}
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
                      <FieldLabel htmlFor={field.formName} required>
                        {field.label}
                      </FieldLabel>
                      <FieldContent>
                        <ColorSwatchInput
                          id={field.formName}
                          name={field.formName}
                          onChange={createHandler(field.key)}
                          value={colors[field.key]}
                        />
                        {field.description ? (
                          <FieldDescription>
                            {field.description}
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
            {isPending ? "保存中..." : "テーマを保存"}
          </Button>
        </div>
      </form>
    </div>
  );
};
