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
import Image from "next/image";
import { useActionState, useCallback, useEffect, useState } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { CreatorActionState, CreatorListItem } from "../creator-types";

interface CreatorFormProps {
  mode: "create" | "update";
  action: (
    prevState: CreatorActionState,
    formData: FormData
  ) => Promise<CreatorActionState>;
  initialCreator?: CreatorListItem;
}

interface IconImageFieldProps {
  clearIconImage: boolean;
  initialCreator?: CreatorListItem;
  isUpdate: boolean;
  onClearIconImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const IconImageField = ({
  clearIconImage,
  initialCreator,
  isUpdate,
  onClearIconImageChange,
}: IconImageFieldProps) => {
  const iconImageUrl = initialCreator?.iconImageUrl ?? "";
  const hasExistingIconImage = iconImageUrl.length > 0;

  return (
    <Field>
      <FieldLabel htmlFor="creator_icon_image">著者アイコン画像</FieldLabel>
      <FieldContent>
        {hasExistingIconImage && !clearIconImage ? (
          <Image
            alt="現在の著者アイコン"
            className="size-20 rounded-full border object-cover"
            height={80}
            src={iconImageUrl}
            unoptimized
            width={80}
          />
        ) : null}
        <Input
          accept="image/jpeg,image/png,image/webp"
          id="creator_icon_image"
          name="icon_image"
          type="file"
        />
        {isUpdate && hasExistingIconImage ? (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              checked={clearIconImage}
              onChange={onClearIconImageChange}
              type="checkbox"
            />
            現在のアイコン画像を削除する
          </label>
        ) : null}
        <input
          name="clear_icon_image"
          type="hidden"
          value={clearIconImage ? "1" : "0"}
        />
        <FieldDescription>
          JPEG/PNG/WebP、10MB以下、256x256px以上の画像を選択してください。
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

export const CreatorForm = ({
  mode,
  action,
  initialCreator,
}: CreatorFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [name, setName] = useState(initialCreator?.name ?? "");
  const [profileText, setProfileText] = useState(
    initialCreator?.profileText ?? ""
  );
  const [clearIconImage, setClearIconImage] = useState(false);

  useEffect(() => {
    setName(initialCreator?.name ?? "");
    setProfileText(initialCreator?.profileText ?? "");
    setClearIconImage(false);
  }, [initialCreator?.name, initialCreator?.profileText, mode]);

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

  const handleClearIconImageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setClearIconImage(event.target.checked);
    },
    []
  );

  const isUpdate = mode === "update";
  let submitLabel = "著者を作成";
  if (isUpdate) {
    submitLabel = "著者を更新";
  }
  if (isPending) {
    submitLabel = "送信中...";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "著者情報" : "新規著者"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "名前とプロフィールを編集します。"
            : "名前とプロフィールを入力してください。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
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
                placeholder="著者の紹介文を入力"
                rows={5}
                value={profileText}
              />
              <FieldDescription>
                著者の自己紹介や経歴などを記入できます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <IconImageField
            clearIconImage={clearIconImage}
            initialCreator={initialCreator}
            isUpdate={isUpdate}
            onClearIconImageChange={handleClearIconImageChange}
          />

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
