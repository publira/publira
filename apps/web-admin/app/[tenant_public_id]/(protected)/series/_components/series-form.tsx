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
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState } from "react";

import type { SeriesActionState, SeriesListItem } from "../series-types";

interface SeriesFormProps {
  mode: "create" | "update";
  tenantPublicId: string;
  action: (
    prevState: SeriesActionState,
    formData: FormData
  ) => Promise<SeriesActionState>;
  defaultReadingPeriodHours: number;
  initialSeries?: SeriesListItem;
}

export const SeriesForm = ({
  mode,
  tenantPublicId,
  action,
  defaultReadingPeriodHours,
  initialSeries,
}: SeriesFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);

  const isUpdate = mode === "update";
  let submitLabel = "シリーズを作成";
  if (isUpdate) {
    submitLabel = "シリーズを更新";
  }
  if (isPending) {
    submitLabel = "送信中...";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "シリーズ情報" : "新規シリーズ"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "タイトル・概要・公開設定などを編集します。"
            : "シリーズの基本情報を入力してください。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input
            name="public_id"
            type="hidden"
            value={initialSeries?.publicId ?? ""}
          />

          <Field>
            <FieldLabel htmlFor="series_title" required>
              タイトル
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSeries?.title ?? ""}
                id="series_title"
                name="title"
                placeholder="例: 海風と活版印刷"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="series_reading_period_hours" required>
              閲覧可能期間
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={
                  initialSeries?.readingPeriodHours ?? defaultReadingPeriodHours
                }
                id="series_reading_period_hours"
                min={0}
                name="reading_period_hours"
                required
                type="number"
              />
              <FieldDescription>
                単位は時間です。0 を指定すると無制限で閲覧できます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="series_synopsis" required>
              概要
            </FieldLabel>
            <FieldContent>
              <Textarea
                defaultValue={initialSeries?.synopsis ?? ""}
                id="series_synopsis"
                name="synopsis"
                placeholder="シリーズの紹介文を入力"
                required
                rows={5}
              />
            </FieldContent>
          </Field>

          {isUpdate ? null : (
            <Field>
              <FieldLabel htmlFor="series_label_public_id" required>
                レーベル公開 ID
              </FieldLabel>
              <FieldContent>
                <Input
                  id="series_label_public_id"
                  name="label_public_id"
                  placeholder="例: label_demo"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              className="h-4 w-4 rounded border-input"
              defaultChecked={initialSeries?.isPublished ?? false}
              name="is_published"
              type="checkbox"
            />
            公開する
          </label>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
