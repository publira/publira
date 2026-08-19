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

import type { TenantIconActionState } from "../settings-types";

interface TenantIconFormProps {
  action: (
    prevState: TenantIconActionState,
    formData: FormData
  ) => Promise<TenantIconActionState>;
  initialIcon: TenantBrandingImage | null;
}

export const TenantIconForm = ({
  action,
  initialIcon,
}: TenantIconFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // What the card shows is the last icon the server confirmed — not the last
  // Action state. Deriving it from `state` alone would put the pre-upload icon
  // back the moment a later attempt is rejected, because a failure carries no
  // icon of its own.
  const [icon, setIcon] = useState(initialIcon);
  const [prevInitialIcon, setPrevInitialIcon] = useState(initialIcon);
  const [prevState, setPrevState] = useState(state);

  if (initialIcon !== prevInitialIcon) {
    setPrevInitialIcon(initialIcon);
    setIcon(initialIcon);
  }

  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setIcon(state.icon);
    }
  }

  const preview = tenantBrandingVariant(icon);

  return (
    <Card>
      <CardHeader>
        <CardTitle>アイコン</CardTitle>
        <CardDescription>
          公開サイトのタブやロケーションバーに表示するアイコンです。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" ref={formRef}>
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>現在のアイコン</FieldLabel>
            <FieldContent>
              {preview ? (
                <Image
                  alt="現在のアイコン"
                  className="size-16 rounded-md border bg-card object-contain"
                  height={preview.height}
                  src={preview.url}
                  width={preview.width}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  アイコンは設定されていません。
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>アイコン画像</FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="icon"
                type="file"
              />
              <FieldDescription>
                JPEG/PNG/WebP、10MB以下、32x32px以上の画像を選択してください。中央を正方形に切り出して保存します。
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
                description="公開サイトのアイコンはブラウザの既定に戻ります。"
                onAction={() => {
                  formRef.current?.requestSubmit(deleteButtonRef.current);
                }}
                title="アイコンを削除しますか？"
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
              アイコンを削除
            </button>
            <Button
              disabled={isPending}
              name="intent"
              type="submit"
              value="upload"
            >
              {isPending ? "保存中..." : "アイコンを保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
