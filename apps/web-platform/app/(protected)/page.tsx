import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PlatformPage } from "#components/platform-page";
import { getAuditActionLabel } from "#lib/audit-log-labels";
import { getPlatformDashboardSummary } from "#lib/dashboard";
import type {
  PlatformDashboardRecentEvent,
  PlatformDashboardSummary,
} from "#lib/dashboard";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

const recentEventsLimit = 6;

const getRecentEventLabel = (event: PlatformDashboardRecentEvent): string => {
  switch (event.eventType) {
    case "tenant_created": {
      return "テナント作成";
    }
    case "operator_role_granted": {
      return "オペレーター権限付与";
    }
    case "end_user_created": {
      return "エンドユーザー作成";
    }
    default: {
      return getAuditActionLabel(event.action);
    }
  }
};

const getRecentEventTone = (
  eventType: string
): "destructive" | "info" | "muted" | "success" | "warning" => {
  switch (eventType) {
    case "tenant_created": {
      return "success";
    }
    case "operator_role_granted": {
      return "info";
    }
    case "end_user_created": {
      return "warning";
    }
    default: {
      return "muted";
    }
  }
};

const getRecentEventTypeLabel = (eventType: string): string => {
  switch (eventType) {
    case "tenant_created": {
      return "Tenant";
    }
    case "operator_role_granted": {
      return "Operator";
    }
    case "end_user_created": {
      return "User";
    }
    default: {
      return eventType || "Event";
    }
  }
};

const buildTargetHref = (
  event: PlatformDashboardRecentEvent
): string | null => {
  switch (event.eventType) {
    case "tenant_created": {
      return event.target ? `/tenants/${event.target}` : null;
    }
    case "operator_role_granted":
    case "end_user_created": {
      return event.target ? `/users/${event.target}` : null;
    }
    default: {
      return null;
    }
  }
};

const getStatCards = (summary: PlatformDashboardSummary | null) =>
  [
    {
      detail: summary
        ? `稼働中 ${summary.activeTenants} / 停止中 ${summary.suspendedTenants}`
        : "全テナントの最新状況を表示します",
      label: "総テナント数",
      value: summary ? String(summary.totalTenants) : "-",
    },
    {
      detail: summary
        ? `全体の ${summary.totalTenants} 件中`
        : "現在稼働しているテナント数です",
      label: "稼働中テナント",
      value: summary ? String(summary.activeTenants) : "-",
    },
    {
      detail: summary
        ? `再開・原因確認が必要な件数`
        : "停止中のテナント数を表示します",
      label: "停止中テナント",
      value: summary ? String(summary.suspendedTenants) : "-",
    },
    {
      detail: summary
        ? "招待未完了 / inactive 扱いのユーザー"
        : "確認待ちのユーザー数を表示します",
      label: "保留ユーザー",
      value: summary ? String(summary.pendingEndUsers) : "-",
    },
  ] as const;

const DashboardSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {(["s1", "s2", "s3", "s4"] as const).map((key) => (
        <Card key={key}>
          <CardHeader className="gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-12 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-4 w-40 animate-pulse rounded bg-muted/70" />
          </CardContent>
        </Card>
      ))}
    </div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
      <Card>
        <CardHeader>
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <div className="h-12 animate-pulse rounded bg-muted/70" />
            <div className="h-12 animate-pulse rounded bg-muted/70" />
            <div className="h-12 animate-pulse rounded bg-muted/70" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

const DashboardContent = async () => {
  const result = await getPlatformDashboardSummary({
    recentEventsLimit,
  });
  const summary = result.ok ? result.summary : null;
  const stats = getStatCards(summary);

  return (
    <>
      {result.ok ? null : (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          ダッシュボードの取得に失敗しました: {result.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <Card key={item.label}>
            <CardHeader className="gap-3">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {item.detail}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1">
              <CardTitle>直近の横断イベント</CardTitle>
              <CardDescription>
                テナント発行、権限付与、ユーザー生成をまとめて把握し、必要に応じて詳細画面へ遷移します。
              </CardDescription>
            </div>
            <StatusChip status={summary ? "info" : "warning"}>
              {summary ? `更新 ${summary.recentEvents.length} 件` : "未取得"}
            </StatusChip>
          </CardHeader>

          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>イベント</TableHead>
                  <TableHead>対象</TableHead>
                  <TableHead className="w-52">実行者</TableHead>
                  <TableHead className="w-52">時刻</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!summary || summary.recentEvents.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={4}>
                      {summary
                        ? "直近イベントはまだありません。"
                        : "イベント取得後にここへ表示されます。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.recentEvents.map((event) => {
                    const href = buildTargetHref(event);

                    return (
                      <TableRow
                        key={`${event.at}-${event.eventType}-${event.target}`}
                      >
                        <TableCell>
                          <div className="grid gap-1">
                            <p className="font-medium">
                              {getRecentEventLabel(event)}
                            </p>
                            <p>
                              <StatusChip
                                status={getRecentEventTone(event.eventType)}
                              >
                                {getRecentEventTypeLabel(event.eventType)}
                              </StatusChip>
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {href ? (
                            <Link
                              className="font-medium text-primary underline-offset-4 hover:underline"
                              href={href}
                            >
                              {event.target}
                            </Link>
                          ) : (
                            <span>{event.target || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell>{event.actor || "system"}</TableCell>
                        <TableCell>
                          {formatDateTime(event.at, { fallback: "-" })}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>次アクション</CardTitle>
            <CardDescription>
              状況確認のあとに利用頻度の高い画面へすぐ移動できます。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/tenants"
            >
              テナント一覧を開く
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/audit-logs"
            >
              監査ログを確認する
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/operators"
            >
              オペレーター管理へ
            </Link>
            <Link
              className="rounded-md border border-border/80 px-3 py-3 font-medium text-foreground transition hover:border-primary/40 hover:bg-accent"
              href="/tenants/new"
            >
              新規テナントを作成する
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const Page = () => (
  <PlatformPage
    actions={
      <>
        <LinkButton render={<Link href="/audit-logs" />} variant="outline">
          監査ログを見る
        </LinkButton>
        <LinkButton render={<Link href="/tenants" />}>
          テナント一覧へ
        </LinkButton>
      </>
    }
    description="プラットフォーム全体のテナント状態、保留件数、直近イベントを最初に確認するためのダッシュボードです。"
    eyebrow="Platform Dashboard"
    title="横断オペレーションの基準点"
  >
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  </PlatformPage>
);

export default Page;
