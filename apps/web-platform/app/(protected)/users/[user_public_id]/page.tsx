import { Badge } from "@publira/ui-components/badge";
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
import { canManageEndUsers } from "#lib/roles";
import { getEndUserStatusLabel, getEndUserStatusTone } from "#lib/user-labels";
import { getPlatformEndUser } from "#lib/users";

import { DangerConfirmButton } from "./_components/danger-confirm-button";
import {
  deleteEndUserAction,
  suspendEndUserAction,
  unsuspendEndUserAction,
} from "./_lib/actions";

export const metadata: Metadata = {
  title: "ユーザー詳細",
};

interface UserDetailPageProps {
  params: Promise<{
    user_public_id: string;
  }>;
}

const UserDetailSkeleton = () => (
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted/70" />
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="h-12 animate-pulse rounded bg-muted/70" />
          <div className="h-12 animate-pulse rounded bg-muted/70" />
          <div className="h-12 animate-pulse rounded bg-muted/70" />
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-16 animate-pulse rounded bg-muted/70" />
      </CardContent>
    </Card>
  </div>
);

const UserDetailContent = async ({
  userPublicId,
}: {
  userPublicId: string;
}) => {
  const [userResult, currentOperator] = await Promise.all([
    getPlatformEndUser(userPublicId),
    getPlatformCurrentOperator(),
  ]);

  if (!userResult.ok || !userResult.user) {
    notFound();
  }

  const { user } = userResult;
  const canManage = canManageEndUsers(currentOperator?.role);
  const canSuspend = canManage && user.status === "active";
  const canUnsuspend = canManage && user.status === "suspended";
  const canDelete = canManage;

  return (
    <PlatformPage
      actions={
        <>
          <LinkButton render={<Link href="/users" />} variant="outline">
            一覧へ戻る
          </LinkButton>
          {canUnsuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={unsuspendEndUserAction}
              actionText="停止解除する"
              actionVariant="default"
              description="停止中ユーザーのログインを再度許可します。"
              title="アカウントの停止を解除しますか？"
              triggerLabel="停止解除"
              triggerVariant="outline"
            />
          ) : null}
          {canSuspend ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={suspendEndUserAction}
              actionText="停止する"
              description="停止中はログインできません。必要に応じて後から停止解除できます。"
              title="アカウントを停止しますか？"
              triggerLabel="停止"
              triggerVariant="outline"
            />
          ) : null}
          {canDelete ? (
            <DangerConfirmButton
              actionArg={user.publicId}
              actionCreator={deleteEndUserAction}
              actionText="削除する"
              description="この操作は取り消せません。対象ユーザーのアカウントは完全に削除されます。"
              title="アカウントを削除しますか？"
              triggerLabel="削除"
            />
          ) : null}
        </>
      }
      description="ユーザーの基本情報と所属テナントを確認し、アカウント状態を管理します。"
      eyebrow="Platform Users"
      title={`ユーザー詳細: ${user.name || user.publicId}`}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>
              ユーザーの登録情報と現在ステータスを表示します。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field>
              <FieldLabel>公開ID</FieldLabel>
              <p className="font-mono text-xs">{user.publicId}</p>
            </Field>
            <Field>
              <FieldLabel>氏名</FieldLabel>
              <p className="text-sm">{user.name || "未設定"}</p>
            </Field>
            <Field>
              <FieldLabel>メールアドレス</FieldLabel>
              <p className="text-sm">{user.email}</p>
            </Field>
            <Field>
              <FieldLabel>登録日</FieldLabel>
              <p className="text-sm">{user.createdAt || "未設定"}</p>
            </Field>
            <Field>
              <FieldLabel>ステータス</FieldLabel>
              <p>
                <Badge tone={getEndUserStatusTone(user.status)}>
                  {getEndUserStatusLabel(user.status)}
                </Badge>
              </p>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>所属テナント</CardTitle>
            <CardDescription>
              このユーザーが所属するテナント一覧を表示します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user.tenantIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                所属テナントはありません。
              </p>
            ) : (
              <ul className="grid gap-2">
                {user.tenantIds.map((tenantId) => (
                  <li key={tenantId}>
                    <Link
                      className="text-sm text-primary underline-offset-4 hover:underline"
                      href={`/tenants/${tenantId}`}
                    >
                      {tenantId}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PlatformPage>
  );
};

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { user_public_id: userPublicId } = await params;

  return (
    <Suspense fallback={<UserDetailSkeleton />}>
      <UserDetailContent userPublicId={userPublicId} />
    </Suspense>
  );
}
