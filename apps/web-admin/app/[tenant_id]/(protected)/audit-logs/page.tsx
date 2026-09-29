import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableLoadingRow,
  TableRow,
} from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listAuditActorCandidates, listAuditLogs } from "#lib/audit";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ActorFilterCombobox } from "./_components/actor-filter-combobox";
import { AuditActionSelect } from "./_components/audit-action-select";
import {
  AuditLogActionCell,
  AuditLogActorCell,
  AuditLogDateCell,
  AuditLogOutcomeCell,
} from "./_components/audit-log-cells";
import { auditActions } from "./_lib/audit-actions";
import { parseAuditLogFilters } from "./_lib/search-params";

const pageSize = 20;

type AuditLogsPageProps = PageProps<"/[tenant_id]/audit-logs">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.audit.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const allowedActionValues: ReadonlySet<string> = new Set(auditActions);

const AuditLogsSkeleton = () => (
  <AdminSections>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SkeletonLine className="h-4 w-16" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-20" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-24" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-12" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableLoadingRow colSpan={4} rows={6} />
      </TableBody>
    </Table>
  </AdminSections>
);

const AuditLogsContent = async ({
  searchParams,
}: Pick<AuditLogsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseAuditLogFilters(sp, allowedActionValues);
  const locale = await getLocale(tenantId);

  const [t, result, actorCandidatesResult, timeZone] = await Promise.all([
    getMessagesFor(locale),
    listAuditLogs(tenantId, locale, {
      action: filters.action,
      actorUserPublicId: filters.actor,
      createdFrom: filters.from,
      createdTo: filters.to,
      limit: pageSize,
      token: filters.token,
    }),
    listAuditActorCandidates(tenantId, locale, {
      limit: 100,
      query: filters.actor,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result, actorCandidatesResult);

  const previousHref = result.previousToken
    ? buildQueryString({
        action: filters.action,
        actor: filters.actor,
        from: filters.from,
        to: filters.to,
        token: result.previousToken,
      })
    : "";
  const nextHref = result.nextToken
    ? buildQueryString({
        action: filters.action,
        actor: filters.actor,
        from: filters.from,
        to: filters.to,
        token: result.nextToken,
      })
    : "";

  const actorItems = actorCandidatesResult.ok
    ? actorCandidatesResult.actors.map((actor) => ({
        label: actor.name
          ? t("admin.audit.actor_option", {
              id: actor.publicId,
              name: actor.name,
            })
          : actor.publicId,
        value: actor.publicId,
      }))
    : [];

  return (
    <AdminSections>
      <section className="grid gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message
              message="admin.audit.filter.description"
              values={{
                time_zone: timeZone,
              }}
            />
          </Suspense>
        </p>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.from" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input defaultValue={filters.from} name="from" type="date" />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.to" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input defaultValue={filters.to} name="to" type="date" />
            </FieldContent>
          </Field>

          <AuditActionSelect defaultValue={filters.action} />

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.actor" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <ActorFilterCombobox
                defaultValue={filters.actor}
                items={actorItems}
              />
            </FieldContent>
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.apply" />
              </Suspense>
            </Button>
            <LinkButton href="/audit-logs" variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.reset" />
              </Suspense>
            </LinkButton>
          </div>
        </form>
      </section>

      <div className="grid gap-4">
        {result.ok ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.created_at" />
                    </Suspense>
                  </TableHead>
                  <TableHead className="w-56">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.actor" />
                    </Suspense>
                  </TableHead>
                  <TableHead>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.action" />
                    </Suspense>
                  </TableHead>
                  <TableHead className="w-32">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.outcome" />
                    </Suspense>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.auditLogs.length === 0 ? (
                  <TableEmptyRow colSpan={4}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.empty" />
                    </Suspense>
                  </TableEmptyRow>
                ) : (
                  result.auditLogs.map((item) => (
                    <TableRow
                      key={`${item.createdAt}-${item.actorUserPublicId}-${item.action}-${item.targetId}`}
                    >
                      <AuditLogDateCell
                        createdAt={item.createdAt}
                        locale={locale}
                        timeZone={timeZone}
                      />
                      <AuditLogActorCell
                        actorName={item.actorName}
                        actorRole={item.actorRole}
                        actorUserPublicId={item.actorUserPublicId}
                        locale={locale}
                      />
                      <AuditLogActionCell
                        action={item.action}
                        locale={locale}
                        reason={item.reason}
                        targetId={item.targetId}
                        targetType={item.targetType}
                      />
                      <AuditLogOutcomeCell
                        locale={locale}
                        outcome={item.outcome}
                      />
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message
                    message="admin.audit.pagination_description"
                    values={{
                      count: pageSize,
                    }}
                  />
                </Suspense>
              </p>
              <div className="flex gap-2">
                {previousHref ? (
                  <LinkButton href={previousHref} variant="outline">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.common.previous" />
                    </Suspense>
                  </LinkButton>
                ) : null}
                {nextHref ? (
                  <LinkButton href={nextHref} variant="outline">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.common.next" />
                    </Suspense>
                  </LinkButton>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <SectionError>
            <SectionErrorHeading>
              <SectionErrorTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.audit.section_error" />
                </Suspense>
              </SectionErrorTitle>
              <SectionErrorDescription>
                {result.message}
              </SectionErrorDescription>
            </SectionErrorHeading>
          </SectionError>
        )}
      </div>
    </AdminSections>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.audit.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.audit.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.audit.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<AuditLogsSkeleton />}>
          <AuditLogsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default AuditLogsPage;
