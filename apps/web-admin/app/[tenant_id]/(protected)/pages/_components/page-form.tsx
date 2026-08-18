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
import { useActionState, useCallback, useState } from "react";
import type { ChangeEvent } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import { formatPagePath, normalizePageSlugInput } from "../page-types";
import type { PageFormState, PageListItem } from "../page-types";

interface PageFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  initialPage?: PageListItem;
  mode: "create" | "update";
}

export const PageForm = ({ action, initialPage, mode }: PageFormProps) => {
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  // Initial values only; entity switch must remount the form via key on the parent.
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [slug, setSlug] = useState(initialPage?.slug ?? "");
  const [title, setTitle] = useState(initialPage?.title ?? "");
  const [displayInFooter, setDisplayInFooter] = useState(
    initialPage?.displayInFooter ?? false
  );

  const isUpdate = mode === "update";
  const handleSlugBlur = useCallback(() => {
    setSlug((current) => normalizePageSlugInput(current));
  }, []);
  const handleSlugChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSlug(event.target.value);
    },
    []
  );
  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTitle(event.target.value);
    },
    []
  );
  const handleDisplayInFooterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDisplayInFooter(event.target.checked);
    },
    []
  );
  const handleContentMarkdownChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setContentMarkdown(event.target.value);
    },
    []
  );

  let submitLabel = "ページを作成";
  if (isPending) {
    submitLabel = "送信中...";
  } else if (isUpdate) {
    submitLabel = "基本情報を更新";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isUpdate ? "ページ基本情報" : "新規ページ"}</CardTitle>
        <CardDescription>
          {isUpdate
            ? "タイトルとフッター表示を更新します。slug は公開 URL の一部になるため変更できません。"
            : "slug とタイトルを設定してページを作成します。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="page_id" type="hidden" value={initialPage?.id ?? ""} />
          <input
            name="display_in_footer"
            type="hidden"
            value={displayInFooter ? "true" : "false"}
          />

          <Field>
            <FieldLabel>slug</FieldLabel>
            <FieldContent>
              <Input
                disabled={isUpdate}
                name="slug"
                onBlur={handleSlugBlur}
                onChange={handleSlugChange}
                placeholder="/privacy"
                type="text"
                value={slug}
              />
              <FieldDescription>
                公開 URL は {formatPagePath(slug)} になります。空欄は /。先頭の
                / は任意で、半角小文字・数字・ハイフン（複数階層は /
                区切り）を利用できます。
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required>タイトル</FieldLabel>
            <FieldContent>
              <Input
                name="title"
                onChange={handleTitleChange}
                placeholder="プライバシーポリシー"
                required
                type="text"
                value={title}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldContent>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  checked={displayInFooter}
                  onChange={handleDisplayInFooterChange}
                  type="checkbox"
                />
                フッターに表示する
              </label>
              <FieldDescription>
                公開中のページのみ、公開サイトのフッターにタイトルリンクとして表示されます。既定はオフです。
              </FieldDescription>
            </FieldContent>
          </Field>

          {isUpdate ? null : (
            <Field>
              <FieldLabel>本文</FieldLabel>
              <FieldContent>
                <Textarea
                  name="content_markdown"
                  onChange={handleContentMarkdownChange}
                  placeholder="# プライバシーポリシー"
                  rows={16}
                  value={contentMarkdown}
                />
                <FieldDescription>
                  ここで初回の本文も登録できます。作成後は編集画面で下書き保存、差分確認、公開管理を行えます。
                </FieldDescription>
              </FieldContent>
            </Field>
          )}

          {state ? (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isPending} type="submit">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
