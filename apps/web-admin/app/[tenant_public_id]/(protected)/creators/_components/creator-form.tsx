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
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";

import type { CreatorActionState, CreatorListItem } from "../creator-types";

interface CreatorFormProps {
  mode: "create" | "update";
  tenantPublicId: string;
  action: (
    prevState: CreatorActionState,
    formData: FormData
  ) => Promise<CreatorActionState>;
  initialCreator?: CreatorListItem;
}

export const CreatorForm = ({
  mode,
  tenantPublicId,
  action,
  initialCreator,
}: CreatorFormProps) => {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, null);
  const [name, setName] = useState(initialCreator?.name ?? "");
  const [profileText, setProfileText] = useState(
    initialCreator?.profileText ?? ""
  );

  useEffect(() => {
    setName(initialCreator?.name ?? "");
    setProfileText(initialCreator?.profileText ?? "");
  }, [initialCreator?.name, initialCreator?.profileText, mode]);

  useEffect(() => {
    if (state?.ok && state.mode === "create") {
      router.push(`/creators/${state.creator.publicId}/edit`);
    }
  }, [router, state]);

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const handleProfileTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setProfileText(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";
  let submitLabel = "クリエイターを作成";
  if (isUpdate) {
    submitLabel = "クリエイターを更新";
  }
  if (isPending) {
    submitLabel = "送信中...";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isUpdate ? "クリエイター情報" : "新規クリエイター"}
        </CardTitle>
        <CardDescription>
          {isUpdate
            ? "名前とプロフィールを編集します。"
            : "名前とプロフィールを入力してください。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input
            name="public_id"
            type="hidden"
            value={initialCreator?.publicId ?? ""}
          />

          <Field>
            <FieldLabel htmlFor="creator_name" required>
              名前
            </FieldLabel>
            <FieldContent>
              <Input
                id="creator_name"
                name="name"
                onChange={handleNameChange}
                placeholder="例: 太郎"
                required
                type="text"
                value={name}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="creator_profile_text">プロフィール</FieldLabel>
            <FieldContent>
              <Textarea
                id="creator_profile_text"
                name="profile_text"
                onChange={handleProfileTextChange}
                placeholder="クリエイターの紹介文を入力"
                rows={5}
                value={profileText}
              />
              <FieldDescription>
                クリエイターの自己紹介や経歴などを記入できます。
              </FieldDescription>
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
