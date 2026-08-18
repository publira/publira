"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useState } from "react";
import type { ChangeEvent } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelFormProps {
  mode: "create" | "update";
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel?: LabelListItem;
}

const getSubmitLabel = (isUpdate: boolean, isPending: boolean): string => {
  if (isPending) {
    return "送信中...";
  }
  if (isUpdate) {
    return "レーベルを更新";
  }
  return "レーベルを作成";
};

const getCardTitle = (isUpdate: boolean): string => {
  if (isUpdate) {
    return "レーベル情報";
  }
  return "新規レーベル";
};

const getCardDescription = (isUpdate: boolean): string => {
  if (isUpdate) {
    return "レーベル名を編集します。";
  }
  return "新しいレーベル名を入力してください。";
};

export const LabelForm = ({ mode, action, initialLabel }: LabelFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const initialName = initialLabel?.name ?? "";
  const [name, setName] = useState(initialName);
  const [prevInitialName, setPrevInitialName] = useState(initialName);
  const [prevMode, setPrevMode] = useState(mode);

  if (initialName !== prevInitialName || mode !== prevMode) {
    setPrevInitialName(initialName);
    setPrevMode(mode);
    setName(initialName);
  }

  // Successful create redirects from the server action (see createLabelAction).
  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";
  const submitLabel = getSubmitLabel(isUpdate, isPending);
  const cardTitle = getCardTitle(isUpdate);
  const cardDescription = getCardDescription(isUpdate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cardTitle}</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            name="public_id"
            type="hidden"
            value={initialLabel?.publicId ?? ""}
          />

          <Field>
            <FieldLabel required>レーベル名</FieldLabel>
            <FieldContent>
              <Input
                name="name"
                onChange={handleNameChange}
                placeholder="例: 月刊ノベルズ"
                required
                type="text"
                value={name}
              />
            </FieldContent>
          </Field>

          {isUpdate ? null : (
            <Field>
              <FieldLabel>レーベルアイキャッチ画像</FieldLabel>
              <FieldContent>
                <Input
                  accept="image/jpeg,image/png,image/webp"
                  name="eye_catch_image"
                  type="file"
                />
                <p className="text-sm text-muted-foreground">
                  3:4 基準で 2400x3200px 以上、10MB 以下の画像を推奨します。
                </p>
              </FieldContent>
            </Field>
          )}

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
