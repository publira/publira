import { LinkButton } from "@publira/ui-components/button";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

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

const TenantMembersContent = async ({
  params,
}: Pick<TenantMembersPageProps, "params">) => {
  const { tenant_id: tenantId } = await params;

  const [tenant, members, invitations] = await Promise.all([
    getPlatformTenant(tenantId),
    listPlatformTenantMembers(tenantId),
    listPlatformTenantAdminInvitations(tenantId),
  ]);

  if (!tenant) {
    notFound();
  }

  return (
    <PlatformPage>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
          <PlatformPageTitle>{`メンバー管理: ${tenant.name}`}</PlatformPageTitle>
          <PlatformPageDescription>
            テナントメンバーの追加、ロール変更、削除を行います。
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            一覧へ戻る
          </LinkButton>
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
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
      </PlatformPageContent>
    </PlatformPage>
  );
};

const TenantMembersPage = ({ params }: TenantMembersPageProps) => (
  <Suspense fallback={<TenantMembersSkeleton />}>
    <TenantMembersContent params={params} />
  </Suspense>
);

export default TenantMembersPage;
