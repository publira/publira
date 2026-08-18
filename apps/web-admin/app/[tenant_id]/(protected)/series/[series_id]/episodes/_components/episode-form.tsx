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
import { useActionState, useCallback } from "react";

import { fillInstantFromDateTimeLocal } from "#lib/datetime-local-form";
import { useTenantId } from "#lib/use-tenant-id";

import type { EpisodeActionState } from "../episode-types";
import { PublishAtInput } from "./publish-at-input";

interface EpisodeFormProps {
  seriesPublicId: string;
  action: (
    prevState: EpisodeActionState,
    formData: FormData
  ) => Promise<EpisodeActionState>;
  timeZone: string;
}

export const EpisodeForm = ({
  seriesPublicId,
  action,
  timeZone,
}: EpisodeFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      fillInstantFromDateTimeLocal(event.currentTarget, {
        isoName: "publish_at",
        localName: "publish_at_local",
        timeZone,
      });
    },
    [timeZone]
  );

  let submitLabel = "エピソードを入稿";
  if (isPending) {
    submitLabel = "送信中...";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>エピソード入稿フォーム</CardTitle>
        <CardDescription>
          エピソードの基本情報と公開設定を入力して登録します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={formAction}
          className="grid gap-4"
          onSubmit={handleSubmit}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />

          <Field>
            <FieldLabel required>タイトル</FieldLabel>
            <FieldContent>
              <Input
                name="title"
                placeholder="例: 第1話 はじまりの朝"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>価格</FieldLabel>
            <FieldContent>
              <Input
                defaultValue={0}
                min={0}
                name="price"
                required
                type="number"
              />
              <FieldDescription>
                0 を指定すると無料で公開されます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>閲覧可能期間</FieldLabel>
            <FieldContent>
              <Input
                defaultValue={0}
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

          <PublishAtInput timeZone={timeZone} />

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
