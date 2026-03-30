import { LinkButton } from "@publira/ui-components/button";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PlatformPage } from "../../../../../components/platform-page";
import {
  getPlatformTenant,
  listPlatformTenantAdminInvitations,
  listPlatformTenantMembers,
} from "../../../../../lib/tenants";
import { TenantSectionNav } from "../_components/tenant-section-nav";
import {
  addTenantMemberAction,
  cancelTenantAdminInvitationAction,
  createTenantAdminInvitationAction,
  removeTenantMemberAction,
  resendTenantAdminInvitationAction,
  updateTenantMemberRoleAction,
} from "../_lib/actions";
import { TenantMembersManager } from "./_components/tenant-members-manager";

export const metadata: Metadata = {
  title: "テナントメンバー管理",
};

interface TenantMembersPageProps {
  params: Promise<{
    tenant_public_id: string;
  }>;
}

const TenantMembersSkeleton = () => (
  <div className="grid gap-6">
    <div className="h-10 w-64 animate-pulse rounded bg-muted/70" />
    <Card>
      <CardHeader>
        <div className="h-5 w-36 animate-pulse rounded bg-muted" />
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

const TenantMembersContent = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const [tenant, members, invitations] = await Promise.all([
    getPlatformTenant(tenantPublicId),
    listPlatformTenantMembers(tenantPublicId),
    listPlatformTenantAdminInvitations(tenantPublicId),
  ]);

  if (!tenant) {
    notFound();
  }

  return (
    <PlatformPage
      actions={
        <LinkButton render={<Link href="/tenants" />} variant="outline">
          一覧へ戻る
        </LinkButton>
      }
      description="テナントメンバーの追加、ロール変更、削除を行います。"
      eyebrow="Platform Tenants"
      title={`メンバー管理: ${tenant.name}`}
    >
      <div className="grid gap-6">
        <TenantSectionNav current="members" tenantPublicId={tenant.publicId} />

        <TenantMembersManager
          addAction={addTenantMemberAction}
          cancelInvitationAction={cancelTenantAdminInvitationAction}
          createInvitationAction={createTenantAdminInvitationAction}
          invitations={invitations}
          members={members}
          removeAction={removeTenantMemberAction}
          resendInvitationAction={resendTenantAdminInvitationAction}
          tenantPublicId={tenant.publicId}
          updateRoleAction={updateTenantMemberRoleAction}
        />
      </div>
    </PlatformPage>
  );
};

export default async function TenantMembersPage({
  params,
}: TenantMembersPageProps) {
  const { tenant_public_id: tenantPublicId } = await params;

  return (
    <Suspense fallback={<TenantMembersSkeleton />}>
      <TenantMembersContent tenantPublicId={tenantPublicId} />
    </Suspense>
  );
}
