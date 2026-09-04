"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import { Input } from "@publira/ui-components/input";
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
import { useActionState, useCallback, useState, useContext } from "react";
import type { ChangeEvent, MouseEvent } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { useTenantId } from "#lib/use-tenant-id";

import {
  buildVersionDiff,
  getDefaultComparisonVersionId,
} from "../_lib/version-diff";
import { formatPageDateTime, formatPagePath } from "../page-types";
import type {
  PageFormState,
  PageListItem,
  PageVersionListItem,
} from "../page-types";
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
  timeZone: string;
  updatePageAction: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
}

const getVersionStatus = (
  messages: ReturnType<typeof sharedCatalog>,
  page: PageListItem,
  version: PageVersionListItem
): { label: string; tone: "info" | "muted" | "warning" } => {
  if (page.publishedVersionId === version.id) {
    return {
      label: getMessage(messages, "admin.pages.workspace.published"),
      tone: "info",
    };
  }
  if (version.status === "published") {
    return {
      label: getMessage(messages, "admin.pages.workspace.past_published"),
      tone: "warning",
    };
  }
  return {
    label: getMessage(messages, "admin.pages.workspace.draft"),
    tone: "muted",
  };
};

const getDiffLineDisplay = (line: {
  type: "added" | "removed" | "unchanged";
}) => {
  if (line.type === "added") {
    return {
      className: "bg-emerald-500/10 text-emerald-700",
      prefix: "+",
    };
  }

  if (line.type === "removed") {
    return {
      className: "bg-rose-500/10 text-rose-700",
      prefix: "-",
    };
  }

  return {
    className: "text-muted-foreground",
    prefix: " ",
  };
};

export const PageWorkspace = ({
  createDraftAction,
  initialPage,
  initialVersions,
  publishAction,
  rollbackAction,
  timeZone,
  updatePageAction,
}: PageWorkspaceProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
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
  const [compareVersionId, setCompareVersionId] = useState(() =>
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
  const diffLineEntries = diffResult
    ? (() => {
        const counts = new Map<string, number>();
        return diffResult.lines.map((line) => {
          const fingerprint = `${line.type}:${line.value}`;
          const count = counts.get(fingerprint) ?? 0;
          counts.set(fingerprint, count + 1);
          return {
            key: `${fingerprint}:${count}`,
            line,
          };
        });
      })()
    : [];

  const versionOptions = initialVersions.map((version) => {
    const status = getVersionStatus(messages, initialPage, version);
    return {
      label: getMessage(messages, "admin.pages.workspace.version_option", {
        status: status.label,
        version: String(version.versionNumber),
      }),
      value: version.id,
    };
  });
  const availableCompareOptions = versionOptions.filter(
    (option) => option.value !== selectedVersionId
  );

  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTitle(event.target.value);
    },
    []
  );
  const handleDraftContentChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setDraftContent(event.target.value);
    },
    []
  );
  const handleLoadVersionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { versionId } = event.currentTarget.dataset;
      if (!versionId) {
        return;
      }

      const version = initialVersions.find((entry) => entry.id === versionId);
      if (!version) {
        return;
      }

      setDraftContent(version.contentMarkdown);
      setSelectedVersionId(version.id);
    },
    [initialVersions]
  );
  const handleSelectedVersionChange = (nextValue: string | null) => {
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
  };
  const handleCompareVersionChange = useCallback((nextValue: string | null) => {
    setCompareVersionId(nextValue ?? "");
  }, []);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.pages.workspace.basic_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.pages.workspace.basic_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={titleFormAction} className="grid gap-4">
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input name="page_id" type="hidden" value={initialPage.id} />
            <input name="slug" type="hidden" value={initialPage.slug} />

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>slug</FieldLabel>
                <FieldContent>
                  <Input
                    className="bg-muted/40 text-muted-foreground"
                    disabled
                    value={formatPagePath(initialPage.slug)}
                  />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel required>
                  {getMessage(messages, "admin.pages.workspace.title")}
                </FieldLabel>
                <FieldContent>
                  <Input
                    name="title"
                    onChange={handleTitleChange}
                    required
                    type="text"
                    value={title}
                  />
                </FieldContent>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={initialPage.publishedVersionId ? "info" : "muted"}>
                {initialPage.publishedVersionId
                  ? getMessage(messages, "admin.pages.workspace.published")
                  : getMessage(messages, "admin.pages.workspace.draft")}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {getMessage(messages, "admin.pages.workspace.updated_at", {
                  date: formatPageDateTime(
                    initialPage.updatedAt,
                    locale,
                    timeZone
                  ),
                })}
              </span>
            </div>

            {titleState ? (
              <FormMessage variant="destructive">
                {titleState.message}
              </FormMessage>
            ) : null}

            <div className="flex justify-end">
              <Button disabled={isTitlePending} type="submit">
                {isTitlePending
                  ? getMessage(messages, "admin.pages.workspace.updating")
                  : getMessage(messages, "admin.pages.workspace.update_title")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {getMessage(messages, "admin.pages.workspace.editor_title")}
            </CardTitle>
            <CardDescription>
              {getMessage(messages, "admin.pages.workspace.editor_description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={draftFormAction} className="grid gap-4">
              <input name="tenant_id" type="hidden" value={tenantId} />
              <input name="page_id" type="hidden" value={initialPage.id} />
              <input name="title" type="hidden" value={initialPage.title} />

              <Field>
                <FieldLabel>
                  {getMessage(messages, "admin.pages.workspace.body")}
                </FieldLabel>
                <FieldContent>
                  <Textarea
                    name="content_markdown"
                    onChange={handleDraftContentChange}
                    rows={24}
                    value={draftContent}
                  />
                  <FieldDescription>
                    {getMessage(
                      messages,
                      "admin.pages.workspace.body_description"
                    )}
                  </FieldDescription>
                </FieldContent>
              </Field>

              {draftState ? (
                <FormMessage variant="destructive">
                  {draftState.message}
                </FormMessage>
              ) : null}

              <div className="flex justify-end">
                <Button disabled={isDraftPending} type="submit">
                  {isDraftPending
                    ? getMessage(messages, "admin.pages.workspace.saving")
                    : getMessage(messages, "admin.pages.workspace.save_draft")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {getMessage(messages, "admin.pages.workspace.preview_title")}
            </CardTitle>
            <CardDescription>
              {getMessage(
                messages,
                "admin.pages.workspace.preview_description"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MarkdownPreview content={draftContent} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.pages.workspace.versions_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.pages.workspace.versions_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialVersions.length === 0 ? (
            <FormMessage>
              {getMessage(messages, "admin.pages.workspace.versions_empty")}
            </FormMessage>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">
                    {getMessage(
                      messages,
                      "admin.pages.workspace.columns.version"
                    )}
                  </TableHead>
                  <TableHead className="w-24">
                    {getMessage(
                      messages,
                      "admin.pages.workspace.columns.status"
                    )}
                  </TableHead>
                  <TableHead>
                    {getMessage(
                      messages,
                      "admin.pages.workspace.columns.created_at"
                    )}
                  </TableHead>
                  <TableHead>
                    {getMessage(
                      messages,
                      "admin.pages.workspace.columns.published_at"
                    )}
                  </TableHead>
                  <TableHead className="w-[320px]">
                    {getMessage(
                      messages,
                      "admin.pages.workspace.columns.actions"
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialVersions.map((version) => {
                  const status = getVersionStatus(
                    messages,
                    initialPage,
                    version
                  );

                  return (
                    <TableRow key={version.id}>
                      <TableCell className="font-medium">
                        v{version.versionNumber}
                      </TableCell>
                      <TableCell>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {formatPageDateTime(
                          version.createdAt,
                          locale,
                          timeZone
                        )}
                      </TableCell>
                      <TableCell>
                        {formatPageDateTime(
                          version.publishedAt,
                          locale,
                          timeZone
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            data-version-id={version.id}
                            onClick={handleLoadVersionClick}
                            type="button"
                            variant="outline"
                          >
                            {getMessage(messages, "admin.pages.workspace.load")}
                          </Button>

                          <form action={publishAction}>
                            <input
                              name="tenant_id"
                              type="hidden"
                              value={tenantId}
                            />
                            <input
                              name="page_id"
                              type="hidden"
                              value={initialPage.id}
                            />
                            <input
                              name="version_id"
                              type="hidden"
                              value={version.id}
                            />
                            <Button
                              disabled={
                                initialPage.publishedVersionId === version.id
                              }
                              type="submit"
                              variant="outline"
                            >
                              {getMessage(
                                messages,
                                "admin.pages.workspace.publish"
                              )}
                            </Button>
                          </form>

                          <form action={rollbackAction}>
                            <input
                              name="tenant_id"
                              type="hidden"
                              value={tenantId}
                            />
                            <input
                              name="page_id"
                              type="hidden"
                              value={initialPage.id}
                            />
                            <input
                              name="version_id"
                              type="hidden"
                              value={version.id}
                            />
                            <Button type="submit" variant="outline">
                              {getMessage(
                                messages,
                                "admin.pages.workspace.rollback"
                              )}
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
          <CardTitle>
            {getMessage(messages, "admin.pages.workspace.diff_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.pages.workspace.diff_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {initialVersions.length <= 1 ? (
            <FormMessage>
              {getMessage(messages, "admin.pages.workspace.diff_empty")}
            </FormMessage>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>
                    {getMessage(messages, "admin.pages.workspace.compare_from")}
                  </FieldLabel>
                  <FieldContent>
                    <Select
                      items={versionOptions}
                      onValueChange={handleSelectedVersionChange}
                      value={selectedVersionId}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>
                    {getMessage(messages, "admin.pages.workspace.compare_to")}
                  </FieldLabel>
                  <FieldContent>
                    <Select
                      items={availableCompareOptions}
                      onValueChange={handleCompareVersionChange}
                      value={compareVersionId}
                    />
                  </FieldContent>
                </Field>
              </div>

              {diffResult ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="info">
                      {getMessage(
                        messages,
                        "admin.pages.workspace.diff_added",
                        {
                          count: diffResult.summary.added,
                        }
                      )}
                    </Badge>
                    <Badge tone="warning">
                      {getMessage(
                        messages,
                        "admin.pages.workspace.diff_removed",
                        {
                          count: diffResult.summary.removed,
                        }
                      )}
                    </Badge>
                    <Badge tone="muted">
                      {getMessage(
                        messages,
                        "admin.pages.workspace.diff_unchanged",
                        {
                          count: diffResult.summary.unchanged,
                        }
                      )}
                    </Badge>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
                    <div className="max-h-105 overflow-auto font-mono text-xs leading-6">
                      {diffLineEntries.map(({ key, line }) => {
                        const display = getDiffLineDisplay(line);

                        return (
                          <div
                            className={`grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-4 py-1 ${display.className}`}
                            key={key}
                          >
                            <span>{display.prefix}</span>
                            <span className="wrap-break-word whitespace-pre-wrap">
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
