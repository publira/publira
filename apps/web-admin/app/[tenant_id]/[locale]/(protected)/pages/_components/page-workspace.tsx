import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { Suspense } from "react";

import { Message } from "#components/message";

import { formatPageDateTime, formatPagePath } from "../page-types";
import type {
  PageFormState,
  PageListItem,
  PageVersionListItem,
} from "../page-types";
import * as PageDraft from "./page-draft-controls";
import { PagePublishForm } from "./page-publish-form";

interface PageWorkspaceProps {
  /** See {@link PagePublishForm}. */
  asksReadersToAgree: boolean;
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

/**
 * A version's status, with a note under it where a publication of the version
 * asked readers to agree to the page again. A version without one keeps the
 * badge alone, as every page that readers do not agree to shows it.
 */
const VersionStatusCell = ({
  page,
  version,
}: {
  page: PageListItem;
  version: PageVersionListItem;
}) => {
  const badge = (
    <Badge tone={versionTone(page, version)}>
      <Suspense fallback={<SkeletonLine className="h-3 w-12" />}>
        <VersionStatus page={page} version={version} />
      </Suspense>
    </Badge>
  );

  if (!version.agreementRequiredAt) {
    return badge;
  }

  return (
    <div className="grid justify-items-start gap-1">
      {badge}
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
          <Message message="admin.pages.workspace.agreement_required" />
        </Suspense>
      </span>
    </div>
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
  asksReadersToAgree,
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
  <PageDraft.Root
    publishedVersionId={initialPage.publishedVersionId}
    versions={initialVersions}
  >
    <ConsoleSection.Stack>
      {/* No section heading: the page heading already names this form. */}
      <ConsoleSection.Root>
        <PublicationStatus
          locale={locale}
          page={initialPage}
          tenantId={tenantId}
          timeZone={timeZone}
          unpublishAction={unpublishAction}
        />

        <PageDraft.SaveForm action={saveAction} className="grid gap-4">
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

          <ActionForm.Fieldset className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field.Root>
                <Field.Label>slug</Field.Label>
                <Field.Content>
                  <Input
                    className="bg-muted/40 text-muted-foreground"
                    disabled
                    value={formatPagePath(initialPage.slug)}
                  />
                  <Field.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                      <Message message="admin.pages.workspace.slug_description" />
                    </Suspense>
                  </Field.Description>
                </Field.Content>
              </Field.Root>

              <Field.Root>
                <Field.Label required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.title" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <Input
                    defaultValue={initialPage.title}
                    name="title"
                    required
                    type="text"
                  />
                </Field.Content>
              </Field.Root>
            </div>

            {/* The page's, not the translation's: every language tab shows and saves the same value. */}
            <Field.Root>
              <div className="flex items-center gap-2">
                {/* Keyed by the stored value, so a save that re-renders the screen with a new one starts the box from it: Base UI's uncontrolled default is read once. */}
                <Checkbox
                  defaultChecked={initialPage.displayInFooter}
                  key={String(initialPage.displayInFooter)}
                  name="display_in_footer"
                  uncheckedValue="false"
                  value="true"
                />
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.pages.workspace.footer_visible" />
                  </Suspense>
                </Field.Label>
              </div>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.pages.workspace.footer_description" />
                </Suspense>
              </Field.Description>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.pages.workspace.body" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <PageDraft.Editor />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.pages.workspace.body_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </ActionForm.Fieldset>

          <div className="flex justify-end">
            <ActionForm.Submit>
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.pages.workspace.save" />
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.pages.workspace.saving" />
                </Suspense>
              </ActionForm.Pending>
            </ActionForm.Submit>
          </div>
        </PageDraft.SaveForm>
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.pages.workspace.versions_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.pages.workspace.versions_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {initialVersions.length === 0 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.pages.workspace.versions_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.columns.version" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-24">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.pages.workspace.columns.status" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.created_at" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.published_at" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="w-[320px]">
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.pages.workspace.columns.actions" />
                  </Suspense>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {initialVersions.map((version) => (
                <Table.Row key={version.id}>
                  <Table.Cell className="font-medium">
                    v{version.versionNumber}
                  </Table.Cell>
                  <Table.Cell>
                    <VersionStatusCell page={initialPage} version={version} />
                  </Table.Cell>
                  <Table.Cell>
                    {formatPageDateTime(version.createdAt, locale, timeZone)}
                  </Table.Cell>
                  <Table.Cell>
                    {formatPageDateTime(version.publishedAt, locale, timeZone)}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-2">
                      <PageDraft.VersionLoadButton versionId={version.id}>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.pages.workspace.load" />
                        </Suspense>
                      </PageDraft.VersionLoadButton>

                      <PagePublishForm
                        asksReadersToAgree={asksReadersToAgree}
                        disabled={initialPage.publishedVersionId === version.id}
                        pageId={initialPage.id}
                        publishAction={publishAction}
                        tenantId={tenantId}
                        translationLocale={initialPage.locale ?? ""}
                        version={version}
                      />

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
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
                <Message message="admin.pages.workspace.diff_title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.pages.workspace.diff_description" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {initialVersions.length <= 1 ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.pages.workspace.diff_empty" />
            </Suspense>
          </FormMessage>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.pages.workspace.compare_from" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <PageDraft.DiffFromSelect />
                </Field.Content>
              </Field.Root>

              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.pages.workspace.compare_to" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <PageDraft.DiffToSelect />
                </Field.Content>
              </Field.Root>
            </div>

            <PageDraft.VersionDiff />
          </>
        )}
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  </PageDraft.Root>
);
