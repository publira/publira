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

import { useTenantId } from "#lib/use-tenant-id";

import type { TenantFaviconActionState } from "../settings-types";

interface TenantFaviconFormProps {
  action: (
    prevState: TenantFaviconActionState,
    formData: FormData
  ) => Promise<TenantFaviconActionState>;
  initialFaviconUrl: string;
}

export const TenantFaviconForm = ({
  action,
  initialFaviconUrl,
}: TenantFaviconFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // What the card shows is the last favicon the server confirmed — not the last
  // Action state. Deriving it from `state` alone would put the pre-upload icon
  // back the moment a later attempt is rejected, because a failure carries no
  // favicon of its own.
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl);
  const [prevInitialFaviconUrl, setPrevInitialFaviconUrl] =
    useState(initialFaviconUrl);
  const [prevState, setPrevState] = useState(state);

  if (initialFaviconUrl !== prevInitialFaviconUrl) {
    setPrevInitialFaviconUrl(initialFaviconUrl);
    setFaviconUrl(initialFaviconUrl);
  }

  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) {
      setFaviconUrl(state.faviconUrl);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ファビコン</CardTitle>
        <CardDescription>
          公開サイトのタブに表示するアイコンです。ロゴとは別に設定でき、未設定のときはロゴが使われます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" ref={formRef}>
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>現在のファビコン</FieldLabel>
            <FieldContent>
              {faviconUrl ? (
                <Image
                  alt="現在のファビコン"
                  className="size-16 rounded-md border bg-card object-contain"
                  height={64}
                  src={faviconUrl}
                  width={64}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  ファビコンは設定されていません。
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>ファビコン画像</FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="favicon"
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
            {faviconUrl ? (
              <ConfirmDialog
                actionText="削除する"
                actionVariant="destructive"
                description="公開サイトのアイコンはロゴ、またはデフォルトのアイコンに戻ります。"
                onAction={() => {
                  formRef.current?.requestSubmit(deleteButtonRef.current);
                }}
                title="ファビコンを削除しますか？"
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
              ファビコンを削除
            </button>
            <Button
              disabled={isPending}
              name="intent"
              type="submit"
              value="upload"
            >
              {isPending ? "保存中..." : "ファビコンを保存"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
