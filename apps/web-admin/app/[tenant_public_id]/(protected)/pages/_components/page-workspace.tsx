"use client";

import { Badge } from "@publira/ui-components/badge";
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
import { Select } from "@publira/ui-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useState } from "react";

import { formatPageDateTime, formatPagePath } from "../page-types";
import type { PageListItem, PageVersionListItem } from "../page-types";
import type { PageFormState } from "../page-types";
import {
  buildVersionDiff,
  getDefaultComparisonVersionId,
} from "../_lib/version-diff";
import { MarkdownPreview } from "./markdown-preview";

interface PageWorkspaceProps {
  createDraftAction: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  initialPage: PageListItem;
  initialVersions: PageVersionListItem[];
  publishAction: (formData: FormData) => Promise<void>;
  rollbackAction: (formData: FormData) => Promise<void>;
  tenantPublicId: string;
  updatePageAction: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
}

const getVersionStatus = (
  page: PageListItem,
  version: PageVersionListItem
): { label: string; tone: "info" | "muted" | "warning" } => {
  if (page.publishedVersionId === version.id) {
    return { label: "公開中", tone: "info" };
  }
  if (version.status === "published") {
    return { label: "過去公開", tone: "warning" };
  }
  return { label: "下書き", tone: "muted" };
};

export const PageWorkspace = ({
  createDraftAction,
  initialPage,
  initialVersions,
  publishAction,
  rollbackAction,
  tenantPublicId,
  updatePageAction,
}: PageWorkspaceProps) => {
  const [titleState, titleFormAction, isTitlePending] = useActionState(
    updatePageAction,
    null
  );
  const [draftState, draftFormAction, isDraftPending] = useActionState(
    createDraftAction,
    null
  );
  const [title, setTitle] = useState(initialPage.title);
  const [draftContent, setDraftContent] = useState(
    initialVersions[0]?.contentMarkdown ?? ""
  );
  const [selectedVersionId, setSelectedVersionId] = useState(
    initialVersions[0]?.id ?? ""
  );
  const [compareVersionId, setCompareVersionId] = useState(
    getDefaultComparisonVersionId(
      initialPage.publishedVersionId,
      initialVersions
    )
  );

  const selectedVersion =
    initialVersions.find((version) => version.id === selectedVersionId) ??
    initialVersions[0];
  const compareVersion = initialVersions.find(
    (version) => version.id === compareVersionId
  );
  const diffResult =
    selectedVersion && compareVersion
      ? buildVersionDiff(
          selectedVersion.contentMarkdown,
          compareVersion.contentMarkdown
        )
      : null;

  const versionOptions = initialVersions.map((version) => {
    const status = getVersionStatus(initialPage, version);
    return {
      label: `v${version.versionNumber} ・ ${status.label}`,
      value: version.id,
    };
  });
  const availableCompareOptions = versionOptions.filter(
    (option) => option.value !== selectedVersionId
  );

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
          <CardDescription>
            公開 URL とタイトルを管理します。slug は公開導線に影響するため読み取り専用です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={titleFormAction} className="grid gap-4">
            <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
            <input name="page_id" type="hidden" value={initialPage.id} />
            <input name="slug" type="hidden" value={initialPage.slug} />

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="page_slug_readonly">slug</FieldLabel>
                <FieldContent>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground shadow-xs"
                    disabled
                    id="page_slug_readonly"
                    value={formatPagePath(initialPage.slug)}
                  />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="page_title_edit" required>
                  タイトル
                </FieldLabel>
                <FieldContent>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
                    id="page_title_edit"
                    name="title"
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    type="text"
                    value={title}
                  />
                </FieldContent>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={initialPage.publishedVersionId ? "info" : "muted"}>
                {initialPage.publishedVersionId ? "公開中" : "下書き"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                最終更新: {formatPageDateTime(initialPage.updatedAt)}
              </span>
            </div>

            {titleState ? (
              <FormMessage variant="destructive">{titleState.message}</FormMessage>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={isTitlePending} type="submit">
                {isTitlePending ? "更新中..." : "タイトルを更新"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Markdown エディタ</CardTitle>
            <CardDescription>
              内容を保存すると新しい下書きバージョンが作成されます。公開はバージョン一覧から実行します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={draftFormAction} className="grid gap-4">
              <input name="tenant_public_id" type="hidden" value={tenantPublicId} />
              <input name="page_id" type="hidden" value={initialPage.id} />
              <input name="title" type="hidden" value={initialPage.title} />

              <Field>
                <FieldLabel htmlFor="page_content_markdown">本文</FieldLabel>
                <FieldContent>
                  <Textarea
                    id="page_content_markdown"
                    name="content_markdown"
                    onChange={(event) => setDraftContent(event.target.value)}
                    rows={24}
                    value={draftContent}
                  />
                  <FieldDescription>
                    見出し、リスト、引用、コードブロックを含む Markdown を入力できます。
                  </FieldDescription>
                </FieldContent>
              </Field>

              {draftState ? (
                <FormMessage variant="destructive">{draftState.message}</FormMessage>
              ) : null}

              <div className="flex justify-end">
                <Button disabled={isDraftPending} type="submit">
                  {isDraftPending ? "保存中..." : "この内容で下書きを保存"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>プレビュー</CardTitle>
            <CardDescription>
              現在のエディタ内容をレンダリングした見た目です。公開前の確認に使えます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MarkdownPreview content={draftContent} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>バージョン一覧</CardTitle>
          <CardDescription>
            履歴の確認、公開中バージョンの切り替え、旧バージョンからのロールバックを行います。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialVersions.length === 0 ? (
            <FormMessage>まだバージョンがありません。まず下書きを保存してください。</FormMessage>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">版</TableHead>
                  <TableHead className="w-24">状態</TableHead>
                  <TableHead>作成日時</TableHead>
                  <TableHead>公開日時</TableHead>
                  <TableHead className="w-[320px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialVersions.map((version) => {
                  const status = getVersionStatus(initialPage, version);

                  return (
                    <TableRow key={version.id}>
                      <TableCell className="font-medium">
                        v{version.versionNumber}
                      </TableCell>
                      <TableCell>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>{formatPageDateTime(version.createdAt)}</TableCell>
                      <TableCell>{formatPageDateTime(version.publishedAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            onClick={() => {
                              setDraftContent(version.contentMarkdown);
                              setSelectedVersionId(version.id);
                            }}
                            type="button"
                            variant="outline"
                          >
                            内容を読み込む
                          </Button>

                          <form action={publishAction}>
                            <input
                              name="tenant_public_id"
                              type="hidden"
                              value={tenantPublicId}
                            />
                            <input name="page_id" type="hidden" value={initialPage.id} />
                            <input name="version_id" type="hidden" value={version.id} />
                            <Button
                              disabled={initialPage.publishedVersionId === version.id}
                              type="submit"
                              variant="outline"
                            >
                              公開する
                            </Button>
                          </form>

                          <form action={rollbackAction}>
                            <input
                              name="tenant_public_id"
                              type="hidden"
                              value={tenantPublicId}
                            />
                            <input name="page_id" type="hidden" value={initialPage.id} />
                            <input name="version_id" type="hidden" value={version.id} />
                            <Button type="submit" variant="outline">
                              この版へロールバック
                            </Button>
                          </form>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>差分確認</CardTitle>
          <CardDescription>
            比較対象の 2 バージョンを選び、追加・削除の差分を確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {initialVersions.length <= 1 ? (
            <FormMessage>
              差分の表示には 2 件以上のバージョンが必要です。下書きを保存すると履歴が増えます。
            </FormMessage>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="page_diff_current">比較元</FieldLabel>
                  <FieldContent>
                    <Select
                      id="page_diff_current"
                      items={versionOptions}
                      onValueChange={(nextValue) => {
                        if (!nextValue) {
                          return;
                        }
                        setSelectedVersionId(nextValue);
                        if (compareVersionId === nextValue) {
                          const fallbackCompareId = availableCompareOptions.find(
                            (option) => option.value !== nextValue
                          )?.value;
                          setCompareVersionId(fallbackCompareId ?? "");
                        }
                      }}
                      value={selectedVersionId}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="page_diff_previous">比較先</FieldLabel>
                  <FieldContent>
                    <Select
                      id="page_diff_previous"
                      items={availableCompareOptions}
                      onValueChange={(nextValue) => {
                        setCompareVersionId(nextValue ?? "");
                      }}
                      value={compareVersionId}
                    />
                  </FieldContent>
                </Field>
              </div>

              {diffResult ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="info">追加 {diffResult.summary.added}</Badge>
                    <Badge tone="warning">削除 {diffResult.summary.removed}</Badge>
                    <Badge tone="muted">共通 {diffResult.summary.unchanged}</Badge>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
                    <div className="max-h-105 overflow-auto font-mono text-xs leading-6">
                      {diffResult.lines.map((line, index) => {
                        const prefix =
                          line.type === "added"
                            ? "+"
                            : line.type === "removed"
                              ? "-"
                              : " ";
                        const className =
                          line.type === "added"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : line.type === "removed"
                              ? "bg-rose-500/10 text-rose-700"
                              : "text-muted-foreground";

                        return (
                          <div
                            className={`grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-4 py-1 ${className}`}
                            key={`${line.type}-${index}`}
                          >
                            <span>{prefix}</span>
                            <span className="whitespace-pre-wrap wrap-break-word">
                              {line.value || " "}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};