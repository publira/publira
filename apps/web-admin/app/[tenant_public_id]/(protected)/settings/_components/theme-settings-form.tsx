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
import { useActionState, useCallback, useEffect, useId, useState } from "react";

import type { TenantThemeSettings } from "../../../../../lib/theme-settings";
import type { ThemeSettingsActionState } from "../settings-types";

interface ThemeSettingsFormProps {
  action: (
    prevState: ThemeSettingsActionState,
    formData: FormData
  ) => Promise<ThemeSettingsActionState>;
  initialTheme: TenantThemeSettings;
  tenantPublicId: string;
}

interface ColorSwatchInputProps {
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const ColorSwatchInput = ({ id, name, value, onChange }: ColorSwatchInputProps) => {
  const pickerId = useId();
  return (
    <div className="relative flex max-w-48 items-center">
      <label
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

type ColorKey = keyof TenantThemeSettings;

interface ColorFieldConfig {
  key: ColorKey;
  formName: string;
  label: string;
  description?: string;
}

const colorGroups: { title: string; description: string; fields: ColorFieldConfig[] }[] = [
  {
    title: "ブランドカラー",
    description: "ブランドを表す主要カラーです。",
    fields: [
      { key: "primaryColor", formName: "primary_color", label: "プライマリカラー", description: "主にボタンや強調要素で利用される基準カラーです。" },
      { key: "primaryForegroundColor", formName: "primary_foreground_color", label: "プライマリ前景色", description: "プライマリカラー上のテキストや文字に使用する色です。" },
      { key: "secondaryColor", formName: "secondary_color", label: "セカンダリカラー", description: "補助的なボタンや要素に使用するカラーです。" },
      { key: "secondaryForegroundColor", formName: "secondary_foreground_color", label: "セカンダリ前景色", description: "セカンダリカラー上のテキストや文字に使用する色です。" },
      { key: "accentColor", formName: "accent_color", label: "アクセントカラー", description: "通知や装飾のアクセントに利用するカラーです。" },
      { key: "accentForegroundColor", formName: "accent_foreground_color", label: "アクセント前景色", description: "アクセントカラー上のテキストや文字に使用する色です。" },
    ],
  },
  {
    title: "背景・表面カラー",
    description: "ページや各要素の背景色を設定します。",
    fields: [
      { key: "backgroundColor", formName: "background_color", label: "背景色", description: "ページ全体の背景色です。" },
      { key: "foregroundColor", formName: "foreground_color", label: "前景色（テキスト）", description: "背景上のテキストや文字に使用する色です。" },
      { key: "surfaceColor", formName: "surface_color", label: "サーフェス色", description: "コンテンツエリアの表面色です。" },
      { key: "surfaceForegroundColor", formName: "surface_foreground_color", label: "サーフェス前景色", description: "サーフェス上のテキストに使用する色です。" },
      { key: "cardColor", formName: "card_color", label: "カード色", description: "カードコンポーネントの背景色です。" },
      { key: "cardForegroundColor", formName: "card_foreground_color", label: "カード前景色", description: "カード上のテキストに使用する色です。" },
      { key: "popoverColor", formName: "popover_color", label: "ポップオーバー色", description: "ポップオーバーやドロップダウンの背景色です。" },
      { key: "popoverForegroundColor", formName: "popover_foreground_color", label: "ポップオーバー前景色", description: "ポップオーバー上のテキストに使用する色です。" },
      { key: "mutedColor", formName: "muted_color", label: "ミュート色", description: "控えめな背景や無効化された要素に使用する色です。" },
      { key: "mutedForegroundColor", formName: "muted_foreground_color", label: "ミュート前景色", description: "ミュートエリアのテキストに使用する色です。" },
    ],
  },
  {
    title: "UI要素カラー",
    description: "ボーダーや入力欄など UI 要素に使用する色を設定します。",
    fields: [
      { key: "borderColor", formName: "border_color", label: "ボーダー色", description: "テーブルや枠線のボーダー色です。" },
      { key: "inputColor", formName: "input_color", label: "入力フィールド色", description: "フォーム入力要素の背景色です。" },
      { key: "ringColor", formName: "ring_color", label: "フォーカスリング色", description: "フォーカス時に表示されるリングの色です。" },
    ],
  },
  {
    title: "ステータスカラー",
    description: "成功・警告・エラー・情報など通知に使用する色を設定します。",
    fields: [
      { key: "successColor", formName: "success_color", label: "成功色", description: "成功メッセージや操作完了を示す色です。" },
      { key: "successForegroundColor", formName: "success_foreground_color", label: "成功前景色", description: "成功表示上のテキストに使用する色です。" },
      { key: "warningColor", formName: "warning_color", label: "警告色", description: "警告メッセージを示す色です。" },
      { key: "warningForegroundColor", formName: "warning_foreground_color", label: "警告前景色", description: "警告表示上のテキストに使用する色です。" },
      { key: "destructiveColor", formName: "destructive_color", label: "危険色", description: "削除やエラー操作を示す色です。" },
      { key: "destructiveForegroundColor", formName: "destructive_foreground_color", label: "危険前景色", description: "危険表示上のテキストに使用する色です。" },
      { key: "infoColor", formName: "info_color", label: "情報色", description: "情報メッセージを示す色です。" },
      { key: "infoForegroundColor", formName: "info_foreground_color", label: "情報前景色", description: "情報表示上のテキストに使用する色です。" },
    ],
  },
];

export const ThemeSettingsForm = ({
  action,
  initialTheme,
  tenantPublicId,
}: ThemeSettingsFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [colors, setColors] = useState<TenantThemeSettings>(initialTheme);

  useEffect(() => {
    setColors(initialTheme);
  }, [initialTheme]);

  useEffect(() => {
    if (state?.ok) {
      setColors(state.theme);
    }
  }, [state]);

  const createHandler = useCallback(
    (key: ColorKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setColors((prev) => ({ ...prev, [key]: event.target.value }));
    },
    []
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-6">
      <form action={formAction} className="contents">
        <input name="tenant_public_id" type="hidden" value={tenantPublicId} />

        {colorGroups.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-5 sm:max-w-3xl">
                {group.fields.map((field) => (
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
                        <FieldDescription>{field.description}</FieldDescription>
                      ) : null}
                      {fieldErrors?.[field.key] ? (
                        <FormMessage variant="destructive">
                          {fieldErrors[field.key]}
                        </FormMessage>
                      ) : null}
                    </FieldContent>
                  </Field>
                ))}
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
