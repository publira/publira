import { Badge, StatusChip } from "@publira/ui-components/badge";
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
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PlatformPage } from "#components/platform-page";
import {
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { listPlatformOperators } from "#lib/operators";

export const metadata: Metadata = {
  title: "オペレーター管理",
};

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

const OperatorsContent = async () => {
  const operators = await listPlatformOperators();

  return (
    <Card>
      <CardHeader>
        <CardTitle>オペレーター一覧</CardTitle>
        <CardDescription>
          スーパー管理者 / オペレーター /
          監査担当の優先順でロールを付与します。停止中のオペレーターはログインできません。
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            {operators.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  オペレーターはまだ登録されていません。
                </TableCell>
              </TableRow>
            ) : null}
            {operators.map((operator) => (
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
      </CardContent>
    </Card>
  );
};

const OperatorsPage = () => (
  <PlatformPage
    actions={
      <LinkButton render={<Link href="/operators/new" />}>
        オペレーターを追加
      </LinkButton>
    }
    description="プラットフォームオペレーターの一覧・ロール確認・有効化／停止を行います。"
    eyebrow="Platform Governance"
    title="オペレーター管理"
  >
    <Suspense fallback={<OperatorsTableSkeleton />}>
      <OperatorsContent />
    </Suspense>
  </PlatformPage>
);

export default OperatorsPage;
