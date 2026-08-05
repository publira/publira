import { LinkButton } from "@publira/ui-components/button";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PlatformPage } from "#components/platform-page";
import {
  getPlatformTenant,
  listPlatformTenantAdminInvitations,
  listPlatformTenantMembers,
} from "#lib/tenants";

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
    tenant_id: string;
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

const TenantMembersContent = async ({ tenantId }: { tenantId: string }) => {
  const [tenant, members, invitations] = await Promise.all([
    getPlatformTenant(tenantId),
    listPlatformTenantMembers(tenantId),
    listPlatformTenantAdminInvitations(tenantId),
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
        <TenantSectionNav current="members" tenantId={tenant.publicId} />

        <TenantMembersManager
          addAction={addTenantMemberAction}
          cancelInvitationAction={cancelTenantAdminInvitationAction}
          createInvitationAction={createTenantAdminInvitationAction}
          invitations={invitations}
          members={members}
          removeAction={removeTenantMemberAction}
          resendInvitationAction={resendTenantAdminInvitationAction}
          tenantId={tenant.publicId}
          updateRoleAction={updateTenantMemberRoleAction}
        />
      </div>
    </PlatformPage>
  );
};

const TenantMembersPage = async ({ params }: TenantMembersPageProps) => {
  const { tenant_id: tenantId } = await params;

  return (
    <Suspense fallback={<TenantMembersSkeleton />}>
      <TenantMembersContent tenantId={tenantId} />
    </Suspense>
  );
};

export default TenantMembersPage;
