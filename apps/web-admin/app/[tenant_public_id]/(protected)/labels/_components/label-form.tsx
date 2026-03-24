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
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelFormProps {
  mode: "create" | "update";
  tenantPublicId: string;
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel?: LabelListItem;
}

export const LabelForm = ({
  mode,
  tenantPublicId,
  action,
  initialLabel,
}: LabelFormProps) => {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, null);
  const [name, setName] = useState(initialLabel?.name ?? "");

  useEffect(() => {
    setName(initialLabel?.name ?? "");
  }, [initialLabel?.name, mode]);

  useEffect(() => {
    if (state?.ok && state.mode === "create") {
      router.push(`/labels/${state.label.publicId}`);
    }
  }, [router, state]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";
  let submitLabel = "レーベルを作成";
  if (isUpdate) {
    submitLabel = "レーベルを更新";
  }
  if (isPending) {
    submitLabel = "送信中...";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "レーベル情報" : "新規レーベル"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "レーベル名を編集します。"
            : "新しいレーベル名を入力してください。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input
            name="public_id"
            type="hidden"
            value={initialLabel?.publicId ?? ""}
          />

          <Field>
            <FieldLabel htmlFor="label_name" required>
              レーベル名
            </FieldLabel>
            <FieldContent>
              <Input
                id="label_name"
                name="name"
                onChange={handleNameChange}
                placeholder="例: 月刊ノベルズ"
                required
                type="text"
                value={name}
              />
            </FieldContent>
          </Field>

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
