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
import { useActionState, useCallback, useEffect, useState } from "react";

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

type ThemeColorField = "primaryColor" | "secondaryColor" | "accentColor";

const colorInputClassName = "h-10 w-14 shrink-0 cursor-pointer p-1";

export const ThemeSettingsForm = ({
  action,
  initialTheme,
  tenantPublicId,
}: ThemeSettingsFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [primaryColor, setPrimaryColor] = useState(initialTheme.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(
    initialTheme.secondaryColor
  );
  const [accentColor, setAccentColor] = useState(initialTheme.accentColor);

  useEffect(() => {
    setPrimaryColor(initialTheme.primaryColor);
    setSecondaryColor(initialTheme.secondaryColor);
    setAccentColor(initialTheme.accentColor);
  }, [
    initialTheme.accentColor,
    initialTheme.primaryColor,
    initialTheme.secondaryColor,
  ]);

  useEffect(() => {
    if (!state?.ok) {
      return;
    }

    setPrimaryColor(state.theme.primaryColor);
    setSecondaryColor(state.theme.secondaryColor);
    setAccentColor(state.theme.accentColor);
  }, [state]);

  const createColorTextHandler = useCallback(
    (field: ThemeColorField) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        if (field === "primaryColor") {
          setPrimaryColor(value);
        }
        if (field === "secondaryColor") {
          setSecondaryColor(value);
        }
        if (field === "accentColor") {
          setAccentColor(value);
        }
      },
    []
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>テーマカラー設定</CardTitle>
          <CardDescription>
            主要カラーを編集し、管理画面内でプレビューを確認しながら保存できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="grid gap-5 sm:max-w-3xl">
            <input
              name="tenant_public_id"
              type="hidden"
              value={tenantPublicId}
            />

            <Field>
              <FieldLabel htmlFor="primary_color" required>
                プライマリカラー
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    className={colorInputClassName}
                    id="primary_color_picker"
                    onChange={createColorTextHandler("primaryColor")}
                    type="color"
                    value={primaryColor}
                  />
                  <Input
                    id="primary_color"
                    name="primary_color"
                    onChange={createColorTextHandler("primaryColor")}
                    pattern="#[0-9a-fA-F]{6}"
                    placeholder="#2d8d93"
                    required
                    type="text"
                    value={primaryColor}
                  />
                </div>
                <FieldDescription>
                  主にボタンや強調要素で利用される基準カラーです。
                </FieldDescription>
                {fieldErrors?.primaryColor ? (
                  <FormMessage variant="destructive">
                    {fieldErrors.primaryColor}
                  </FormMessage>
                ) : null}
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="secondary_color" required>
                セカンダリカラー
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    className={colorInputClassName}
                    id="secondary_color_picker"
                    onChange={createColorTextHandler("secondaryColor")}
                    type="color"
                    value={secondaryColor}
                  />
                  <Input
                    id="secondary_color"
                    name="secondary_color"
                    onChange={createColorTextHandler("secondaryColor")}
                    pattern="#[0-9a-fA-F]{6}"
                    placeholder="#c4872a"
                    required
                    type="text"
                    value={secondaryColor}
                  />
                </div>
                <FieldDescription>
                  補助的なボタンや要素に使用するカラーです。
                </FieldDescription>
                {fieldErrors?.secondaryColor ? (
                  <FormMessage variant="destructive">
                    {fieldErrors.secondaryColor}
                  </FormMessage>
                ) : null}
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="accent_color" required>
                アクセントカラー
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    className={colorInputClassName}
                    id="accent_color_picker"
                    onChange={createColorTextHandler("accentColor")}
                    type="color"
                    value={accentColor}
                  />
                  <Input
                    id="accent_color"
                    name="accent_color"
                    onChange={createColorTextHandler("accentColor")}
                    pattern="#[0-9a-fA-F]{6}"
                    placeholder="#2f8f5b"
                    required
                    type="text"
                    value={accentColor}
                  />
                </div>
                <FieldDescription>
                  通知や装飾のアクセントに利用するカラーです。
                </FieldDescription>
                {fieldErrors?.accentColor ? (
                  <FormMessage variant="destructive">
                    {fieldErrors.accentColor}
                  </FormMessage>
                ) : null}
              </FieldContent>
            </Field>

            {state ? (
              <FormMessage variant={state.ok ? "success" : "destructive"}>
                {state.message}
              </FormMessage>
            ) : null}

            <div className="mt-1 flex justify-end">
              <Button disabled={isPending} type="submit">
                {isPending ? "保存中..." : "テーマを保存"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>リアルタイムプレビュー</CardTitle>
          <CardDescription>
            現在入力中のカラーで、主要 UI 要素の見え方を確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-md px-3 py-1 text-sm font-medium text-white"
                style={{ backgroundColor: primaryColor }}
              >
                Primary
              </span>
              <span
                className="rounded-md px-3 py-1 text-sm font-medium text-white"
                style={{ backgroundColor: secondaryColor }}
              >
                Secondary
              </span>
              <span
                className="rounded-md px-3 py-1 text-sm font-medium text-white"
                style={{ backgroundColor: accentColor }}
              >
                Accent
              </span>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">テーマサンプル</p>
              <h3 className="mt-1 text-lg font-semibold">ブランドタイトル</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                このプレビューは保存前でも入力内容を即時反映します。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-md px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: primaryColor }}
                  type="button"
                >
                  主要アクション
                </button>
                <button
                  className="rounded-md px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: secondaryColor }}
                  type="button"
                >
                  補助アクション
                </button>
                <button
                  className="rounded-md border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: accentColor, color: accentColor }}
                  type="button"
                >
                  アクセント表示
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
