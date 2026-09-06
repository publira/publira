import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listAuditActorCandidates, listAuditLogs } from "#lib/audit";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
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
  auditActionOptions,
} from "./_components/audit-log-cells";
import {
  parseAuditLogFilters,
  toAllowedActionValues,
} from "./_lib/search-params";

const pageSize = 20;

type AuditLogsPageProps = PageProps<"/[tenant_id]/audit-logs">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.audit.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const allowedActionValues = toAllowedActionValues(auditActionOptions);

const AuditLogsSkeleton = () => (
  <div className="grid gap-6">
    <Card>
      <CardHeader>
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="h-20 animate-pulse rounded bg-muted/70" />
        <div className="h-20 animate-pulse rounded bg-muted/70" />
        <div className="h-20 animate-pulse rounded bg-muted/70" />
        <div className="h-20 animate-pulse rounded bg-muted/70" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  </div>
);

const AuditLogsContent = async ({
  searchParams,
}: Pick<AuditLogsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseAuditLogFilters(sp, allowedActionValues);
  const locale = await getLocale(tenantId);
  const messages = sharedCatalog(locale);

  const [result, actorCandidatesResult, timeZone] = await Promise.all([
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
          ? getMessage(messages, "admin.audit.actor_option", {
              id: actor.publicId,
              name: actor.name,
            })
          : actor.publicId,
        value: actor.publicId,
      }))
    : [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.audit.filter.title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.audit.filter.description", {
              time_zone: timeZone,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.audit.filter.from")}
              </FieldLabel>
              <FieldContent>
                <Input defaultValue={filters.from} name="from" type="date" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.audit.filter.to")}
              </FieldLabel>
              <FieldContent>
                <Input defaultValue={filters.to} name="to" type="date" />
              </FieldContent>
            </Field>

            <AuditActionSelect
              defaultValue={filters.action}
              options={auditActionOptions.map((option) => ({
                label: getMessage(messages, option.messageKey),
                value: option.value,
              }))}
            />

            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.audit.filter.actor")}
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
                {getMessage(messages, "admin.audit.filter.apply")}
              </Button>
              <LinkButton href="/audit-logs" variant="outline">
                {getMessage(messages, "admin.audit.filter.reset")}
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.audit.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.audit.list_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {result.ok ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">
                      {getMessage(messages, "admin.audit.columns.created_at")}
                    </TableHead>
                    <TableHead className="w-56">
                      {getMessage(messages, "admin.audit.columns.actor")}
                    </TableHead>
                    <TableHead>
                      {getMessage(messages, "admin.audit.columns.action")}
                    </TableHead>
                    <TableHead className="w-32">
                      {getMessage(messages, "admin.audit.columns.outcome")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.auditLogs.length === 0 ? (
                    <TableEmptyRow colSpan={4}>
                      {getMessage(messages, "admin.audit.empty")}
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
                  {getMessage(messages, "admin.audit.pagination_description", {
                    count: pageSize,
                  })}
                </p>
                <div className="flex gap-2">
                  {previousHref ? (
                    <LinkButton href={previousHref} variant="outline">
                      {getMessage(messages, "admin.common.previous")}
                    </LinkButton>
                  ) : null}
                  {nextHref ? (
                    <LinkButton href={nextHref} variant="outline">
                      {getMessage(messages, "admin.common.next")}
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
        </CardContent>
      </Card>
    </div>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
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
