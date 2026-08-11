import { Badge } from "@publira/ui-components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { SectionError } from "@publira/ui-components/section-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getDashboard } from "#lib/dashboard";
import { getTenantId } from "#lib/tenant-id";

export const metadata: Metadata = {
  title: "ダッシュボード",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const getQueueStatusTone = (status: "draft" | "scheduled") => {
  if (status === "scheduled") {
    return "info" as const;
  }
  return "muted" as const;
};

const getQueueStatusLabel = (status: "draft" | "scheduled") => {
  if (status === "scheduled") {
    return "予約済み";
  }
  return "下書き";
};

const DashboardSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <Card key={key}>
          <CardHeader className="gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-12 animate-pulse rounded bg-muted" />
          </CardHeader>
        </Card>
      ))}
    </div>
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <div className="h-10 animate-pulse rounded bg-muted/70" />
          <div className="h-10 animate-pulse rounded bg-muted/70" />
          <div className="h-10 animate-pulse rounded bg-muted/70" />
        </div>
      </CardContent>
    </Card>
  </div>
);

const DashboardContent = async () => {
  const tenantId = await getTenantId();
  const result = await getDashboard(tenantId);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title="ダッシュボードを表示できませんでした"
      />
    );
  }

  const { stats, queue } = result;

  const statsItems = [
    { label: "公開中シリーズ", value: stats.publishedSeriesCount },
    { label: "下書きエピソード", value: stats.draftEpisodeCount },
    { label: "予約公開", value: stats.scheduledEpisodeCount },
  ];

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statsItems.map((item) => (
          <Card key={item.label}>
            <CardHeader className="gap-3">
              <CardDescription>{item.label}</CardDescription>
              <CardTitle className="text-3xl">{item.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>公開キュー</CardTitle>
          <CardDescription>
            直近で確認が必要なエピソードと公開予定です。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <EmptyState
              description="現在、下書きまたは予約済みのエピソードはありません。"
              title="公開キューは空です"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>シリーズ</TableHead>
                  <TableHead>エピソード</TableHead>
                  <TableHead className="w-36">状態</TableHead>
                  <TableHead className="w-48">予定</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((item) => (
                  <TableRow
                    key={`${item.seriesPublicId}-${item.episodePublicId}`}
                  >
                    <TableCell className="font-medium">
                      {item.seriesTitle}
                    </TableCell>
                    <TableCell>{item.episodeTitle}</TableCell>
                    <TableCell>
                      <Badge tone={getQueueStatusTone(item.status)}>
                        {getQueueStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDateTime(item.scheduledAt, {
                        fallback: "未設定",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const DashboardPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>ダッシュボード</AdminPageTitle>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary title="ダッシュボードを表示できませんでした">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default DashboardPage;
