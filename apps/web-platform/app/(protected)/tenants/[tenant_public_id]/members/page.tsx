import { LinkButton } from "@publira/ui-components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlatformPage } from "../../../../../components/platform-page";
import {
  getPlatformTenant,
  listPlatformTenantMembers,
} from "../../../../../lib/tenants";
import { TenantSectionNav } from "../_components/tenant-section-nav";
import {
  addTenantMemberAction,
  removeTenantMemberAction,
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

export default async function TenantMembersPage({
  params,
}: TenantMembersPageProps) {
  const { tenant_public_id: tenantPublicId } = await params;

  const [tenant, members] = await Promise.all([
    getPlatformTenant(tenantPublicId),
    listPlatformTenantMembers(tenantPublicId),
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
          members={members}
          removeAction={removeTenantMemberAction}
          tenantPublicId={tenant.publicId}
          updateRoleAction={updateTenantMemberRoleAction}
        />
      </div>
    </PlatformPage>
  );
}
