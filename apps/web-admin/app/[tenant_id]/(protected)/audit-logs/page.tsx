import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  auditLogCsvPath,
  listAuditActorCandidates,
  listAuditLogs,
} from "#lib/audit";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
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
import { resolveAuditLogExportPeriod } from "./_lib/export-period";
import { parseAuditLogFilters } from "./_lib/search-params";

const pageSize = 20;

type AuditLogsPageProps = PageProps<"/[tenant_id]/audit-logs">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin ? t("admin.audit.title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const allowedActionValues: ReadonlySet<string> = new Set(auditActions);

const AuditLogsSkeleton = () => (
  <ConsoleSection.Stack>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>

    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <SkeletonLine className="h-4 w-16" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-20" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-24" />
          </Table.Head>
          <Table.Head>
            <SkeletonLine className="h-4 w-12" />
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.LoadingRow colSpan={4} rows={6} />
      </Table.Body>
    </Table.Root>
  </ConsoleSection.Stack>
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

  const exportPeriod = resolveAuditLogExportPeriod(filters, timeZone);

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
    <ConsoleSection.Stack>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          {exportPeriod.ok ? (
            <LinkButton
              href={auditLogCsvPath({
                action: filters.action,
                actor: filters.actor,
                end: exportPeriod.end,
                start: exportPeriod.start,
              })}
              size="sm"
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.audit.export.button" />
              </Suspense>
            </LinkButton>
          ) : (
            <p className="max-w-xs text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message message="admin.audit.export.period_invalid" />
              </Suspense>
            </p>
          )}
        </div>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.from" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input defaultValue={filters.from} name="from" type="date" />
            </Field.Content>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.to" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input defaultValue={filters.to} name="to" type="date" />
            </Field.Content>
          </Field.Root>

          <AuditActionSelect defaultValue={filters.action} />

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.audit.filter.actor" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <ActorFilterCombobox
                defaultValue={filters.actor}
                items={actorItems}
              />
            </Field.Content>
          </Field.Root>

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
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head className="w-44">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.created_at" />
                    </Suspense>
                  </Table.Head>
                  <Table.Head className="w-56">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.actor" />
                    </Suspense>
                  </Table.Head>
                  <Table.Head>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.action" />
                    </Suspense>
                  </Table.Head>
                  <Table.Head className="w-32">
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.columns.outcome" />
                    </Suspense>
                  </Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {result.auditLogs.length === 0 ? (
                  <Table.EmptyRow colSpan={4}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="admin.audit.empty" />
                    </Suspense>
                  </Table.EmptyRow>
                ) : (
                  result.auditLogs.map((item) => (
                    <Table.Row
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
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>

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
          <SectionError.Root>
            <SectionError.Heading>
              <SectionError.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.audit.section_error" />
                </Suspense>
              </SectionError.Title>
              <SectionError.Description>
                {result.message}
              </SectionError.Description>
            </SectionError.Heading>
          </SectionError.Root>
        )}
      </div>
    </ConsoleSection.Stack>
  );
};

const AuditLogsPage = ({ searchParams }: AuditLogsPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.audit.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.audit.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default AuditLogsPage;
