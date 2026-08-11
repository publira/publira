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
import {
  buildMemberInvitationsPath,
  parseMemberInvitationFilters,
} from "./_lib/search-params";

export const metadata: Metadata = {
  title: "テナントメンバー管理",
};

const invitationPageSize = 20;

type TenantMembersPageProps = PageProps<"/tenants/[tenant_id]/members">;

const TenantMembersSkeleton = () => (
  <PlatformPageContent>
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
  </PlatformPageContent>
);

const TenantMembersContent = async ({
  params,
  searchParams,
}: Pick<TenantMembersPageProps, "params" | "searchParams">) => {
  const { tenant_id: tenantId } = await params;
  const invitationFilters = parseMemberInvitationFilters(await searchParams);

  const [tenant, members, invitationsResult] = await Promise.all([
    getPlatformTenant(tenantId),
    listPlatformTenantMembers(tenantId),
    listPlatformTenantAdminInvitations({
      limit: invitationPageSize,
      tenantId,
      token: invitationFilters.token || undefined,
    }),
  ]);

  if (!tenant) {
    notFound();
  }

  const previousHref = invitationsResult.previousToken
    ? buildMemberInvitationsPath(tenant.publicId, {
        token: invitationsResult.previousToken,
      })
    : undefined;
  const nextHref = invitationsResult.nextToken
    ? buildMemberInvitationsPath(tenant.publicId, {
        token: invitationsResult.nextToken,
      })
    : undefined;

  return (
    <>
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
            invitationErrorMessage={
              invitationsResult.ok ? undefined : invitationsResult.message
            }
            invitations={invitationsResult.invitations}
            invitationsNextHref={nextHref}
            invitationsPreviousHref={previousHref}
            members={members}
            removeAction={removeTenantMemberAction}
            resendInvitationAction={resendTenantAdminInvitationAction}
            tenantId={tenant.publicId}
            updateRoleAction={updateTenantMemberRoleAction}
          />
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const TenantMembersPage = ({
  params,
  searchParams,
}: TenantMembersPageProps) => (
  <PlatformPage>
    <Suspense fallback={<TenantMembersSkeleton />}>
      <TenantMembersContent params={params} searchParams={searchParams} />
    </Suspense>
  </PlatformPage>
);

export default TenantMembersPage;
