"use client";

import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
import { Textarea } from "@publira/ui-components/textarea";
import {
  Suspense,
  useActionState,
  useCallback,
  useContext,
  useState,
} from "react";
import type { ChangeEvent, MouseEvent } from "react";

import {
  AdminLocaleContext,
  useAdminMessages,
} from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
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
  initialPage: PageListItem;
  initialVersions: PageVersionListItem[];
  publishAction: (formData: FormData) => Promise<void>;
  rollbackAction: (formData: FormData) => Promise<void>;
  saveAction: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  timeZone: string;
  unpublishAction: (formData: FormData) => Promise<void>;
}

const versionTone = (
  page: PageListItem,
  version: PageVersionListItem
): "info" | "muted" | "warning" => {
  if (page.publishedVersionId === version.id) {
    return "info";
  }

  return version.status === "published" ? "warning" : "muted";
};

interface PublicationStatusProps {
  page: PageListItem;
  timeZone: string;
  unpublishAction: (formData: FormData) => Promise<void>;
}

/**
 * The page's public state, and the control that leaves it. Its own component
 * because the unpublish control belongs beside the badge it acts on, while the
 * form around the title fields cannot contain a second form.
 */
const PublicationStatus = ({
  page,
  timeZone,
  unpublishAction,
}: PublicationStatusProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const isPublished = Boolean(page.publishedVersionId);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isPublished ? "info" : "muted"}>
          {isPublished
            ? t("admin.pages.workspace.published")
            : t("admin.pages.workspace.draft")}
        </Badge>
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ClientMessage
              message="admin.pages.workspace.updated_at"
              values={{
                date: formatPageDateTime(page.updatedAt, locale, timeZone),
              }}
            />
          </Suspense>
        </span>
        {isPublished ? (
          <form action={unpublishAction}>
            <input name="tenant_id" type="hidden" value={tenantId} />
            <input name="page_id" type="hidden" value={page.id} />
            <Button type="submit" variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.unpublish" />
              </Suspense>
            </Button>
          </form>
        ) : null}
      </div>
      {isPublished ? (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <ClientMessage message="admin.pages.workspace.unpublish_description" />
          </Suspense>
        </p>
      ) : null}
    </div>
  );
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
  initialPage,
  initialVersions,
  publishAction,
  rollbackAction,
  saveAction,
  timeZone,
  unpublishAction,
}: PageWorkspaceProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useAdminMessages();
  const tenantId = useTenantId();
  const [saveState, saveFormAction, isSavePending] = useActionState(
    saveAction,
    null
  );
  const [title, setTitle] = useState(initialPage.title);
  const initialContent = initialVersions[0]?.contentMarkdown ?? "";
  const [draftContent, setDraftContent] = useState(initialContent);
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

  // The label is interpolated into another message, so it has to be a string;
  // the keys stay spelled out where the accessor that resolves them lives.
  const versionStatusLabel = (version: PageVersionListItem): string => {
    if (initialPage.publishedVersionId === version.id) {
      return t("admin.pages.workspace.published");
    }

    return version.status === "published"
      ? t("admin.pages.workspace.past_published")
      : t("admin.pages.workspace.draft");
  };

  const versionOptions = initialVersions.map((version) => ({
    label: t("admin.pages.workspace.version_option", {
      status: versionStatusLabel(version),
      version: String(version.versionNumber),
    }),
    value: version.id,
  }));
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
    <AdminSections>
      {/* No section heading: the page heading already names this form. */}
      <AdminSection>
        <PublicationStatus
          page={initialPage}
          timeZone={timeZone}
          unpublishAction={unpublishAction}
        />

        <form action={saveFormAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="page_id" type="hidden" value={initialPage.id} />
          {/* What this screen loaded, so the save writes each half only where it changed. */}
          <input name="initial_title" type="hidden" value={initialPage.title} />
          <input
            name="initial_content_markdown"
            type="hidden"
            value={initialContent}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>slug</FieldLabel>
              <FieldContent>
                <Input
                  className="bg-muted/40 text-muted-foreground"
                  disabled
                  value={formatPagePath(initialPage.slug)}
                />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.slug_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <ClientMessage message="admin.pages.workspace.title" />
                </Suspense>
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

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.body" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Tabs defaultValue="write">
                <TabsList>
                  <TabsTab value="write">
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <ClientMessage message="admin.pages.workspace.tab_write" />
                    </Suspense>
                  </TabsTab>
                  <TabsTab value="preview">
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <ClientMessage message="admin.pages.workspace.tab_preview" />
                    </Suspense>
                  </TabsTab>
                </TabsList>
                {/* The textarea is the form control, so it stays mounted behind the preview tab: an unmounted one submits nothing and loses the caret. */}
                <TabsPanel keepMounted value="write">
                  <Textarea
                    name="content_markdown"
                    onChange={handleDraftContentChange}
                    rows={14}
                    value={draftContent}
                  />
                </TabsPanel>
                <TabsPanel className="min-h-72" value="preview">
                  <MarkdownPreview content={draftContent} />
                </TabsPanel>
              </Tabs>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <ClientMessage message="admin.pages.workspace.body_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          {saveState ? (
            <FormMessage variant="destructive">{saveState.message}</FormMessage>
          ) : null}

          <div className="flex justify-end">
            <Button disabled={isSavePending} type="submit">
              {isSavePending
                ? t("admin.pages.workspace.saving")
                : t("admin.pages.workspace.save")}
            </Button>
          </div>
        </form>
      </AdminSection>

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.versions_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.versions_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {initialVersions.length === 0 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.pages.workspace.versions_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.columns.version" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.columns.status" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.columns.created_at" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.columns.published_at" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-[320px]">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.columns.actions" />
                  </Suspense>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialVersions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="font-medium">
                    v{version.versionNumber}
                  </TableCell>
                  <TableCell>
                    <Badge tone={versionTone(initialPage, version)}>
                      {versionStatusLabel(version)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatPageDateTime(version.createdAt, locale, timeZone)}
                  </TableCell>
                  <TableCell>
                    {formatPageDateTime(version.publishedAt, locale, timeZone)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-version-id={version.id}
                        onClick={handleLoadVersionClick}
                        type="button"
                        variant="outline"
                      >
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <ClientMessage message="admin.pages.workspace.load" />
                        </Suspense>
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
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-32" />}
                          >
                            <ClientMessage message="admin.pages.workspace.publish" />
                          </Suspense>
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
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-32" />}
                          >
                            <ClientMessage message="admin.pages.workspace.rollback" />
                          </Suspense>
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminSection>

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.diff_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.pages.workspace.diff_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {initialVersions.length <= 1 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.pages.workspace.diff_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.compare_from" />
                  </Suspense>
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
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <ClientMessage message="admin.pages.workspace.compare_to" />
                  </Suspense>
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
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage
                        message="admin.pages.workspace.diff_added"
                        values={{
                          count: diffResult.summary.added,
                        }}
                      />
                    </Suspense>
                  </Badge>
                  <Badge tone="warning">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage
                        message="admin.pages.workspace.diff_removed"
                        values={{
                          count: diffResult.summary.removed,
                        }}
                      />
                    </Suspense>
                  </Badge>
                  <Badge tone="muted">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage
                        message="admin.pages.workspace.diff_unchanged"
                        values={{
                          count: diffResult.summary.unchanged,
                        }}
                      />
                    </Suspense>
                  </Badge>
                </div>

                <div className="overflow-hidden border border-border bg-card">
                  <div className="max-h-105 overflow-auto text-xs leading-6">
                    {diffLineEntries.map(({ key, line }) => {
                      const display = getDiffLineDisplay(line);

                      return (
                        <code
                          className={`grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-4 py-1 font-mono ${display.className}`}
                          key={key}
                        >
                          <span>{display.prefix}</span>
                          <span className="wrap-break-word whitespace-pre-wrap">
                            {line.value || " "}
                          </span>
                        </code>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
      </AdminSection>
    </AdminSections>
  );
};
