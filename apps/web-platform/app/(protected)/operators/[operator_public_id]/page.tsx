import { Badge, StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldLabel } from "@publira/ui-components/field";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PlatformPage } from "#components/platform-page";
import { getPlatformCurrentOperator } from "#lib/auth";
import {
  getOperatorRoleCardDescription,
  getOperatorRoleLabel,
  getOperatorStatusLabel,
} from "#lib/operator-labels";
import { getPlatformOperator } from "#lib/operators";
import { isPlatformSuperAdmin } from "#lib/roles";

import { DangerConfirmButton } from "./_components/danger-confirm-button";
import { OperatorRoleForm } from "./_components/operator-role-form";
import {
  deactivateOperatorAction,
  suspendOperatorAction,
  unsuspendOperatorAction,
  updateOperatorRoleAction,
} from "./_lib/actions";

export const metadata: Metadata = {
  title: "オペレーター詳細",
};

interface OperatorDetailPageProps {
  params: Promise<{
    operator_public_id: string;
  }>;
}

const OperatorDetailSkeleton = () => (
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted/70" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="h-16 animate-pulse rounded bg-muted/70" />
          <div className="h-16 animate-pulse rounded bg-muted/70" />
          <div className="h-16 animate-pulse rounded bg-muted/70" />
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-20 animate-pulse rounded bg-muted/70" />
      </CardContent>
    </Card>
  </div>
);

const OperatorDetailContent = async ({
  operatorPublicId,
}: {
  operatorPublicId: string;
}) => {
  const [operator, currentOperator] = await Promise.all([
    getPlatformOperator(operatorPublicId),
    getPlatformCurrentOperator(),
  ]);

  if (!operator) {
    notFound();
  }

  const isSelf = currentOperator?.publicId === operator.publicId;
  const isSuperAdmin = isPlatformSuperAdmin(currentOperator?.role);
  const isDeactivated = operator.status === "inactive";
  const canModify = isSuperAdmin && !isSelf && !isDeactivated;
  const canSuspend = isSuperAdmin && !isSelf && operator.status === "active";
  const canUnsuspend =
    isSuperAdmin && !isSelf && operator.status === "suspended";

  return (
    <PlatformPage
      actions={
        <>
          <LinkButton render={<Link href="/operators" />} variant="outline">
            一覧へ戻る
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={unsuspendOperatorAction}
              actionText="再有効化する"
              actionVariant="default"
              description="オペレーターを再有効化します。再有効化後はログインできるようになります。"
              title="アカウントを再有効化しますか？"
              triggerLabel="再有効化"
              triggerVariant="outline"
            />
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={suspendOperatorAction}
              actionText="停止する"
              description="停止中はログインできなくなります。再有効化することで元に戻せます。"
              title="アカウントを停止しますか？"
              triggerLabel="停止"
              triggerVariant="outline"
            />
          ) : null}
          {canModify ? (
            <DangerConfirmButton
              actionArg={operator.publicId}
              actionCreator={deactivateOperatorAction}
              actionText="無効化する"
              description="無効化されたアカウントは永久に利用できなくなります。この操作は取り消せません。"
              title="アカウントを無効化しますか？"
              triggerLabel="無効化"
            />
          ) : null}
        </>
      }
      description="オペレーターの基本情報を確認し、ロールの変更や無効化を行います。"
      eyebrow="Platform Governance"
      title={`オペレーター詳細: ${operator.name}`}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>
              オペレーターのアカウント情報と現在の状態を確認します。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4">
              <Field>
                <FieldLabel>名前</FieldLabel>
                <p className="text-sm">{operator.name}</p>
              </Field>
              <Field>
                <FieldLabel>メールアドレス</FieldLabel>
                <p className="text-sm">{operator.email}</p>
              </Field>
              <Field>
                <FieldLabel>現在のロール</FieldLabel>
                <p>
                  <Badge tone="info">
                    {getOperatorRoleLabel(operator.role)}
                  </Badge>
                </p>
              </Field>
              <Field>
                <FieldLabel>状態</FieldLabel>
                <p>
                  <StatusChip
                    status={
                      operator.status === "active" ? "success" : "warning"
                    }
                  >
                    {getOperatorStatusLabel(operator.status)}
                  </StatusChip>
                </p>
              </Field>
              <Field>
                <FieldLabel>作成日時</FieldLabel>
                <p className="text-sm">{operator.createdAt || "未設定"}</p>
              </Field>
              <Field>
                <FieldLabel>最終ログイン</FieldLabel>
                <p className="text-sm text-muted-foreground">未取得</p>
              </Field>
            </div>
          </CardContent>
        </Card>

        {isDeactivated ? null : (
          <Card>
            <CardHeader>
              <CardTitle>ロール変更</CardTitle>
              <CardDescription>
                {getOperatorRoleCardDescription({ isSelf, isSuperAdmin })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OperatorRoleForm
                action={updateOperatorRoleAction}
                currentRole={operator.role}
                disabled={!canModify}
                operatorPublicId={operator.publicId}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </PlatformPage>
  );
};

const OperatorDetailPage = async ({ params }: OperatorDetailPageProps) => {
  const { operator_public_id: operatorPublicId } = await params;

  return (
    <Suspense fallback={<OperatorDetailSkeleton />}>
      <OperatorDetailContent operatorPublicId={operatorPublicId} />
    </Suspense>
  );
};

export default OperatorDetailPage;
