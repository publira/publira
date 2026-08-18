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
import { SectionError } from "@publira/ui-components/section-error";
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
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listAuditActorCandidates, listAuditLogs } from "#lib/audit";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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

export const metadata: Metadata = {
  title: "監査ログ",
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
              <TableHead>日時</TableHead>
              <TableHead>操作者</TableHead>
              <TableHead>アクション</TableHead>
              <TableHead>結果</TableHead>
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

  const [result, actorCandidatesResult, timeZone] = await Promise.all([
    listAuditLogs(tenantId, {
      action: filters.action,
      actorUserPublicId: filters.actor,
      createdFrom: filters.from,
      createdTo: filters.to,
      limit: pageSize,
      token: filters.token,
    }),
    listAuditActorCandidates(tenantId, {
      limit: 100,
      query: filters.actor,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result, actorCandidatesResult);

  const resetHref = buildQueryString({});
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
          ? `${actor.name} (${actor.publicId})`
          : actor.publicId,
        value: actor.publicId,
      }))
    : [];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>絞り込み</CardTitle>
          <CardDescription>
            期間、アクション種別、操作者で自テナントの監査ログを確認します。開始日・終了日はテナントのタイムゾーン（
            {timeZone}）の暦日として解釈します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field>
              <FieldLabel>開始日</FieldLabel>
              <FieldContent>
                <Input defaultValue={filters.from} name="from" type="date" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>終了日</FieldLabel>
              <FieldContent>
                <Input defaultValue={filters.to} name="to" type="date" />
              </FieldContent>
            </Field>

            <AuditActionSelect
              defaultValue={filters.action}
              options={auditActionOptions}
            />

            <Field>
              <FieldLabel>操作者</FieldLabel>
              <FieldContent>
                <ActorFilterCombobox
                  defaultValue={filters.actor}
                  items={actorItems}
                />
              </FieldContent>
            </Field>

            <div className="flex items-end gap-2">
              <Button type="submit">適用</Button>
              <Button
                formAction={resetHref || "?"}
                type="submit"
                variant="outline"
              >
                リセット
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>監査ログ一覧</CardTitle>
          <CardDescription>
            誰が、いつ、何を行い、どの結果になったかを確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {result.ok ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">日時</TableHead>
                    <TableHead className="w-56">操作者</TableHead>
                    <TableHead>アクション</TableHead>
                    <TableHead className="w-32">結果</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.auditLogs.length === 0 ? (
                    <TableEmptyRow colSpan={4}>
                      条件に一致する監査ログはありません。
                    </TableEmptyRow>
                  ) : (
                    result.auditLogs.map((item) => (
                      <TableRow
                        key={`${item.createdAt}-${item.actorUserPublicId}-${item.action}-${item.targetId}`}
                      >
                        <AuditLogDateCell
                          createdAt={item.createdAt}
                          timeZone={timeZone}
                        />
                        <AuditLogActorCell
                          actorName={item.actorName}
                          actorRole={item.actorRole}
                          actorUserPublicId={item.actorUserPublicId}
                        />
                        <AuditLogActionCell
                          action={item.action}
                          reason={item.reason}
                          targetId={item.targetId}
                          targetType={item.targetType}
                        />
                        <AuditLogOutcomeCell outcome={item.outcome} />
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  1ページあたり {pageSize} 件まで表示します。
                </p>
                <div className="flex gap-2">
                  {previousHref ? (
                    <LinkButton href={previousHref} variant="outline">
                      前へ
                    </LinkButton>
                  ) : null}
                  {nextHref ? (
                    <LinkButton href={nextHref} variant="outline">
                      次へ
                    </LinkButton>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <SectionError
              description={result.message}
              title="監査ログを表示できませんでした"
            />
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
        <AdminPageTitle>監査ログ</AdminPageTitle>
        <AdminPageDescription>
          テナント内の操作履歴を確認し、変更の追跡や説明責任に利用します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary title="監査ログを表示できませんでした">
        <Suspense fallback={<AuditLogsSkeleton />}>
          <AuditLogsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default AuditLogsPage;
