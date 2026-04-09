import { FormMessage } from "@publira/ui-components/form-message";
import { guardPlaceholder } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getTenantAdminInvitationState } from "#lib/admin-auth";

import { AcceptInviteForm } from "./_components/accept-invite-form";

export const metadata: Metadata = {
  title: "管理者招待の承諾",
};

interface AcceptInvitePageProps {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<{
    token?: string;
  }>;
}

const AcceptInviteFormContent = async ({
  tenantPublicId,
  token,
}: {
  tenantPublicId: string;
  token: string;
}) => {
  const invitation = await getTenantAdminInvitationState(tenantPublicId, token);

  if (!invitation) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">招待が見つかりません。</FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    let statusMessage = "この招待は期限切れです。";
    if (invitation.status === "accepted") {
      statusMessage = "この招待はすでに承諾済みです。";
    } else if (invitation.status === "canceled") {
      statusMessage = "この招待は取り消されています。";
    }

    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">{statusMessage}</FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {invitation.email} をテナント管理者として招待しています。
      </p>

      <AcceptInviteForm
        accountExists={invitation.accountExists}
        email={invitation.email}
        tenantPublicId={tenantPublicId}
        token={token}
      />
    </div>
  );
};

const AcceptInviteFormWrapper = ({
  tenantPublicId,
  token,
}: {
  tenantPublicId: string;
  token: string;
}) => {
  if (!token) {
    return (
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        <FormMessage variant="destructive">
          招待トークンが見つかりません。
        </FormMessage>
        <div className="text-center text-sm">
          <Link
            className="font-medium text-primary hover:underline"
            href="/login"
          >
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={<div className="h-40 animate-pulse rounded bg-muted/70" />}
    >
      <AcceptInviteFormContent tenantPublicId={tenantPublicId} token={token} />
    </Suspense>
  );
};

export default async function AcceptInvitePage({
  params,
  searchParams,
}: AcceptInvitePageProps) {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const sp = await searchParams;
  const token = sp.token?.trim() ?? "";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-serif text-2xl font-semibold">
            管理者招待の承諾
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            招待を承諾すると、このテナントの管理画面にアクセスできます。
          </p>
        </div>

        <AcceptInviteFormWrapper
          tenantPublicId={tenant_public_id}
          token={token}
        />
      </div>
    </main>
  );
}
