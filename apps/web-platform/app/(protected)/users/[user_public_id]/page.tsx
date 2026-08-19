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
import { SectionError } from "@publira/ui-components/section-error";
import { formatDate } from "@publira/utils";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

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
import { getPlatformCurrentOperator } from "#lib/auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
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

const userDetailParamsSchema = z.object({
  user_public_id: routeParamString(),
});

const UserDetailSkeleton = () => (
  <PlatformPageContent>
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
  </PlatformPageContent>
);

/**
 * A read that failed is not a user that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for an account that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const UserLoadError = ({ message }: { message: string }) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/users" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description={message}
    title="ユーザーを表示できませんでした"
  />
);

const UserDetailContent = async ({
  params,
}: Pick<UserDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(userDetailParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { user_public_id: userPublicId } = parsedParams;

  const [userResult, currentOperatorResult, timeZone] = await Promise.all([
    getPlatformEndUser(userPublicId),
    getPlatformCurrentOperator(),
    getPlatformDisplayTimeZone(),
  ]);

  // Before both branches below: a rejected session reads every record as
  // missing, and a 404 would hide that the operator only needs to sign in again.
  await redirectToLoginIfSessionRejected(userResult, currentOperatorResult);

  if (!userResult.ok) {
    return <UserLoadError message={userResult.message} />;
  }

  const { user } = userResult;
  if (!user) {
    notFound();
  }
  const canManage = canManageEndUsers(
    currentOperatorResult.ok ? currentOperatorResult.operator.role : undefined
  );
  const canSuspend = canManage && user.status === "active";
  const canUnsuspend = canManage && user.status === "suspended";
  const canDelete = canManage;

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Users</PlatformPageEyebrow>
          <PlatformPageTitle>{`ユーザー詳細: ${user.name || user.publicId}`}</PlatformPageTitle>
          <PlatformPageDescription>
            ユーザーの基本情報と所属テナントを確認し、アカウント状態を管理します。
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
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
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
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
                <p className="text-sm">
                  {formatDate(user.createdAt, { fallback: "未設定", timeZone })}
                </p>
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
                        {tenantId === user.primaryTenantPublicId
                          ? user.primaryTenantName || tenantId
                          : tenantId}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const UserDetailPage = ({ params }: UserDetailPageProps) => (
  <PlatformPage>
    <Suspense fallback={<UserDetailSkeleton />}>
      <UserDetailContent params={params} />
    </Suspense>
  </PlatformPage>
);

export default UserDetailPage;
