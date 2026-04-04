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
import { useActionState, useEffect, useState } from "react";

import { formatPagePath, normalizePageSlugInput } from "../page-types";
import type { PageFormState, PageListItem } from "../page-types";

interface PageFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  initialPage?: PageListItem;
  mode: "create" | "update";
  tenantPublicId: string;
}

export const PageForm = ({
  action,
  initialPage,
  mode,
  tenantPublicId,
}: PageFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [slug, setSlug] = useState(initialPage?.slug ?? "");
  const [title, setTitle] = useState(initialPage?.title ?? "");

  useEffect(() => {
    setContentMarkdown("");
    setSlug(initialPage?.slug ?? "");
    setTitle(initialPage?.title ?? "");
  }, [initialPage?.slug, initialPage?.title, mode]);

  const isUpdate = mode === "update";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "ページ基本情報" : "新規ページ"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "タイトルを更新します。slug は公開 URL の一部になるため変更できません。"
            : "slug とタイトルを設定してページを作成します。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
          <input name="page_id" type="hidden" value={initialPage?.id ?? ""} />

          <Field>
            <FieldLabel htmlFor="page_slug">
              slug
            </FieldLabel>
            <FieldContent>
              <Input
                disabled={isUpdate}
                id="page_slug"
                name="slug"
                onBlur={() => setSlug((current) => normalizePageSlugInput(current))}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="/privacy"
                type="text"
                value={slug}
              />
              <FieldDescription>
                公開 URL は {formatPagePath(slug)} になります。空欄は /、それ以外は / で始まる半角小文字・数字・ハイフンを利用できます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="page_title" required>
              タイトル
            </FieldLabel>
            <FieldContent>
              <Input
                id="page_title"
                name="title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="プライバシーポリシー"
                required
                type="text"
                value={title}
              />
            </FieldContent>
          </Field>

          {!isUpdate ? (
            <Field>
              <FieldLabel htmlFor="page_content_markdown">本文</FieldLabel>
              <FieldContent>
                <Textarea
                  id="page_content_markdown"
                  name="content_markdown"
                  onChange={(event) => setContentMarkdown(event.target.value)}
                  placeholder="# プライバシーポリシー"
                  rows={16}
                  value={contentMarkdown}
                />
                <FieldDescription>
                  ここで初回の本文も登録できます。作成後は編集画面で下書き保存、差分確認、公開管理を行えます。
                </FieldDescription>
              </FieldContent>
            </Field>
          ) : null}

          {state ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {isPending
                ? "送信中..."
                : isUpdate
                  ? "タイトルを更新"
                  : "ページを作成"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};