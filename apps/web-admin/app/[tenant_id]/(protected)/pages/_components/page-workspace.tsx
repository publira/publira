import type { Locale } from "@publira/i18n";
import {
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
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
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import { formatPageDateTime, formatPagePath } from "../page-types";
import type {
  PageFormState,
  PageListItem,
  PageVersionListItem,
} from "../page-types";
import {
  PageDiffFromSelect,
  PageDiffToSelect,
  PageDraft,
  PageDraftPreview,
  PageDraftTextarea,
  PageSaveForm,
  PageVersionDiff,
  PageVersionLoadButton,
} from "./page-draft-controls";

interface PageWorkspaceProps {
  initialPage: PageListItem;
  initialVersions: PageVersionListItem[];
  locale: Locale;
  publishAction: (formData: FormData) => Promise<void>;
  rollbackAction: (formData: FormData) => Promise<void>;
  saveAction: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  tenantId: string;
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

const VersionStatus = ({
  page,
  version,
}: {
  page: PageListItem;
  version: PageVersionListItem;
}) => {
  if (page.publishedVersionId === version.id) {
    return <Message message="admin.pages.workspace.published" />;
  }

  return version.status === "published" ? (
    <Message message="admin.pages.workspace.past_published" />
  ) : (
    <Message message="admin.pages.workspace.draft" />
  );
};

interface PublicationStatusProps {
  locale: Locale;
  page: PageListItem;
  tenantId: string;
  timeZone: string;
  unpublishAction: (formData: FormData) => Promise<void>;
}

/**
 * The page's public state, and the control that leaves it. It sits beside the
 * badge it acts on, outside the save form, which cannot contain a second form.
 */
const PublicationStatus = ({
  locale,
  page,
  tenantId,
  timeZone,
  unpublishAction,
}: PublicationStatusProps) => {
  const isPublished = Boolean(page.publishedVersionId);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isPublished ? "info" : "muted"}>
          <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
            {isPublished ? (
              <Message message="admin.pages.workspace.published" />
            ) : (
              <Message message="admin.pages.workspace.draft" />
            )}
          </Suspense>
        </Badge>
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message
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
            <input
              name="translation_locale"
              type="hidden"
              value={page.locale ?? ""}
            />
            <Button type="submit" variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.pages.workspace.unpublish" />
              </Suspense>
            </Button>
          </form>
        ) : null}
      </div>
      {isPublished ? (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.pages.workspace.unpublish_description" />
          </Suspense>
        </p>
      ) : null}
    </div>
  );
};

export const PageWorkspace = ({
  initialPage,
  initialVersions,
  locale,
  publishAction,
  rollbackAction,
  saveAction,
  tenantId,
  timeZone,
  unpublishAction,
}: PageWorkspaceProps) => (
  <PageDraft
    publishedVersionId={initialPage.publishedVersionId}
    versions={initialVersions}
  >
    <AdminSections>
      {/* No section heading: the page heading already names this form. */}
      <AdminSection>
        <PublicationStatus
          locale={locale}
          page={initialPage}
          tenantId={tenantId}
          timeZone={timeZone}
          unpublishAction={unpublishAction}
        />

        <PageSaveForm action={saveAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="page_id" type="hidden" value={initialPage.id} />
          <input
            name="translation_locale"
            type="hidden"
            value={initialPage.locale ?? ""}
          />
          {/* What this screen loaded, so the save writes each half only where it changed. */}
          <input name="initial_title" type="hidden" value={initialPage.title} />
          <input
            name="initial_content_markdown"
            type="hidden"
            value={initialVersions[0]?.contentMarkdown ?? ""}
          />
          <input
            name="initial_display_in_footer"
            type="hidden"
            value={String(initialPage.displayInFooter)}
          />

          <ActionFormFieldset className="grid gap-4">
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
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.pages.workspace.slug_description" />
                    </Suspense>
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.title" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <Input
                    defaultValue={initialPage.title}
                    name="title"
                    required
                    type="text"
                  />
                </FieldContent>
              </Field>
            </div>

            {/* The page's, not the translation's: every language tab shows and saves the same value. */}
            <Field>
              <div className="flex items-center gap-2">
                <Checkbox
                  defaultChecked={initialPage.displayInFooter}
                  name="display_in_footer"
                  uncheckedValue="false"
                  value="true"
                />
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.pages.workspace.footer_visible" />
                  </Suspense>
                </FieldLabel>
              </div>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.pages.workspace.footer_description" />
                </Suspense>
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.pages.workspace.body" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Tabs defaultValue="write">
                  <TabsList>
                    <TabsTab value="write">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-10" />}
                      >
                        <Message message="admin.pages.workspace.tab_write" />
                      </Suspense>
                    </TabsTab>
                    <TabsTab value="preview">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-14" />}
                      >
                        <Message message="admin.pages.workspace.tab_preview" />
                      </Suspense>
                    </TabsTab>
                  </TabsList>
                  {/* The textarea is the form control, so it stays mounted behind the preview tab: an unmounted one submits nothing and loses the caret. */}
                  <TabsPanel keepMounted value="write">
                    <PageDraftTextarea />
                  </TabsPanel>
                  <TabsPanel className="min-h-72" value="preview">
                    <PageDraftPreview />
                  </TabsPanel>
                </Tabs>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.pages.workspace.body_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>
          </ActionFormFieldset>

          <div className="flex justify-end">
            <ActionFormSubmit>
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.pages.workspace.save" />
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.pages.workspace.saving" />
                </Suspense>
              </ActionFormPending>
            </ActionFormSubmit>
          </div>
        </PageSaveForm>
      </AdminSection>

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.pages.workspace.versions_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.pages.workspace.versions_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {initialVersions.length === 0 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.pages.workspace.versions_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.columns.version" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.columns.status" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.created_at" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.published_at" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-[320px]">
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.actions" />
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
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-12" />}
                      >
                        <VersionStatus page={initialPage} version={version} />
                      </Suspense>
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
                      <PageVersionLoadButton versionId={version.id}>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.pages.workspace.load" />
                        </Suspense>
                      </PageVersionLoadButton>

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
                          name="translation_locale"
                          type="hidden"
                          value={initialPage.locale ?? ""}
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
                            fallback={<SkeletonLine className="h-4 w-14" />}
                          >
                            <Message message="admin.pages.workspace.publish" />
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
                          name="translation_locale"
                          type="hidden"
                          value={initialPage.locale ?? ""}
                        />
                        <input
                          name="version_id"
                          type="hidden"
                          value={version.id}
                        />
                        <Button type="submit" variant="outline">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-36" />}
                          >
                            <Message message="admin.pages.workspace.rollback" />
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
              <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
                <Message message="admin.pages.workspace.diff_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.pages.workspace.diff_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {initialVersions.length <= 1 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.pages.workspace.diff_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.pages.workspace.compare_from" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <PageDiffFromSelect />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.pages.workspace.compare_to" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <PageDiffToSelect />
                </FieldContent>
              </Field>
            </div>

            <PageVersionDiff />
          </>
        )}
      </AdminSection>
    </AdminSections>
  </PageDraft>
);
