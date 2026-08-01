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
import { useActionState } from "react";

import type { EpisodeActionState } from "../episode-types";
import { PublishAtInput } from "./publish-at-input";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodeFormProps {
  seriesPublicId: string;
  action: (
    prevState: EpisodeActionState,
    formData: FormData
  ) => Promise<EpisodeActionState>;
}

export const EpisodeForm = ({ seriesPublicId,
  action,
}: EpisodeFormProps) => {

  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);

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
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="series_public_id" type="hidden" value={seriesPublicId} />

          <Field>
            <FieldLabel htmlFor="episode_title" required>
              タイトル
            </FieldLabel>
            <FieldContent>
              <Input
                id="episode_title"
                name="title"
                placeholder="例: 第1話 はじまりの朝"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="episode_price" required>
              価格
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={0}
                id="episode_price"
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
            <FieldLabel htmlFor="episode_reading_period_hours" required>
              閲覧可能期間
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={0}
                id="episode_reading_period_hours"
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

          <PublishAtInput />

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
