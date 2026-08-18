import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PaginationControls } from "#components/pagination-controls";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { listPlatformOperators } from "#lib/operators";

import {
  buildOperatorsPath,
  parseOperatorsSearchParams,
} from "./_lib/search-params";

export const metadata: Metadata = {
  title: "オペレーター管理",
};

const pageSize = 20;

const OperatorsTableSkeleton = () => (
  <Card>
    <CardHeader>
      <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
    </CardHeader>
    <CardContent>
      <div className="grid gap-3">
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
        <div className="h-10 animate-pulse rounded bg-muted/70" />
      </div>
    </CardContent>
  </Card>
);

type OperatorsPageProps = PageProps<"/operators">;

const OperatorsContent = async ({
  searchParams,
}: Pick<OperatorsPageProps, "searchParams">) => {
  const { token } = parseOperatorsSearchParams(await searchParams);
  const result = await listPlatformOperators({ limit: pageSize, token });

  await redirectToLoginIfSessionRejected(result);

  const previousHref = result.previousToken
    ? buildOperatorsPath({ token: result.previousToken })
    : undefined;
  const nextHref = result.nextToken
    ? buildOperatorsPath({ token: result.nextToken })
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>オペレーター一覧</CardTitle>
        <CardDescription>
          スーパー管理者 / オペレーター /
          監査担当の優先順でロールを付与します。停止中のオペレーターはログインできません。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {result.ok ? null : (
          <SectionError
            description={result.message}
            title="オペレーター一覧を表示できませんでした"
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名前</TableHead>
              <TableHead>メール</TableHead>
              <TableHead className="w-48">ロール</TableHead>
              <TableHead className="w-36">状態</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.ok && result.operators.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  オペレーターはまだ登録されていません。
                </TableCell>
              </TableRow>
            ) : null}
            {result.ok &&
              result.operators.map((operator) => (
                <TableRow key={operator.publicId || operator.email}>
                  <TableCell>
                    <div className="grid gap-1">
                      <p className="font-medium text-foreground">
                        {operator.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {operator.publicId}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{operator.email}</TableCell>
                  <TableCell>
                    <Badge tone="info">
                      {getOperatorRoleLabel(operator.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={
                        operator.status === "active" ? "success" : "warning"
                      }
                    >
                      {getOperatorStatusLabel(operator.status)}
                    </StatusChip>
                  </TableCell>
                  <TableCell>
                    <LinkButton
                      render={<Link href={`/operators/${operator.publicId}`} />}
                      size="sm"
                      variant="outline"
                    >
                      詳細
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        <PaginationControls
          ariaLabel="オペレーター一覧のページ送り"
          nextHref={nextHref}
          previousHref={previousHref}
        />
      </CardContent>
    </Card>
  );
};

const OperatorsPage = ({ searchParams }: OperatorsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>オペレーター管理</PlatformPageTitle>
        <PlatformPageDescription>
          プラットフォームオペレーターの一覧・ロール確認・有効化／停止を行います。
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/operators/new" />}>
          オペレーターを追加
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary title="オペレーター一覧を表示できませんでした">
        <Suspense fallback={<OperatorsTableSkeleton />}>
          <OperatorsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorsPage;
