"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { ConfirmDialog } from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import { useActionState, useRef, useState } from "react";

import { tenantBrandingVariant } from "#lib/tenant-branding-image";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantLogoActionState } from "../settings-types";

interface TenantLogoFormProps {
  action: (
    prevState: TenantLogoActionState,
    formData: FormData
  ) => Promise<TenantLogoActionState>;
  initialLogo: TenantBrandingImage | null;
}

export const TenantLogoForm = ({
  action,
  initialLogo,
}: TenantLogoFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // What the card shows is the last logo the server confirmed — not the last
  // Action state. Deriving it from `state` alone would put the pre-upload image
  // back the moment a later attempt is rejected, because a failure carries no
  // logo of its own.
  const [logo, setLogo] = useState(initialLogo);
  const [prevInitialLogo, setPrevInitialLogo] = useState(initialLogo);
  const [prevState, setPrevState] = useState(state);

  if (initialLogo !== prevInitialLogo) {
    setPrevInitialLogo(initialLogo);
    setLogo(initialLogo);
  }

  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setLogo(state.logo);
    }
  }

  // The stored master carries its own width and height, so the preview is laid
  // out at the logo's real aspect ratio instead of a guessed one.
  const preview = tenantBrandingVariant(logo);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ロゴ</CardTitle>
        <CardDescription>
          公開サイトと管理画面のブランド表示に使う画像です。縦横比はそのまま保存されます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" ref={formRef}>
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>現在のロゴ</FieldLabel>
            <FieldContent>
              {preview ? (
                <Image
                  alt="現在のロゴ"
                  className="h-16 w-auto max-w-full rounded-md border bg-card object-contain"
                  height={preview.height}
                  src={preview.url}
                  width={preview.width}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  ロゴは設定されていません。
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>ロゴ画像</FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="logo"
                type="file"
              />
              <FieldDescription>
                JPEG/PNG/WebP、10MB以下、縦横とも32px以上の画像を選択してください。長辺が1024pxを超える場合は縮小して保存します。
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end gap-2">
            {preview ? (
              <ConfirmDialog
                actionText="削除する"
                actionVariant="destructive"
                description="公開サイトと管理画面のブランド表示はテナント名に戻ります。"
                onAction={() => {
                  formRef.current?.requestSubmit(deleteButtonRef.current);
                }}
                title="ロゴを削除しますか？"
                trigger={
                  <Button disabled={isPending} type="button" variant="outline">
                    削除
                  </Button>
                }
              />
            ) : null}
            <button
              className="hidden"
              name="intent"
              ref={deleteButtonRef}
              type="submit"
              value="delete"
            >
              ロゴを削除
            </button>
            <Button
              disabled={isPending}
              name="intent"
              type="submit"
              value="upload"
            >
              {isPending ? "保存中..." : "ロゴを保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
