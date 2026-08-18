import { LinkButton } from "@publira/ui-components/button";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
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
  buildMembersPath,
  parseMemberInvitationFilters,
  parseTenantMembersParams,
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

/**
 * A read that failed is not a tenant that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for a tenant that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const TenantMembersLoadError = ({ message }: { message: string }) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        一覧へ戻る
      </LinkButton>
    }
    description={message}
    title="メンバー管理を表示できませんでした"
  />
);

const TenantMembersContent = async ({
  params,
  searchParams,
}: Pick<TenantMembersPageProps, "params" | "searchParams">) => {
  const parsedParams = parseTenantMembersParams(await params);
  if (!parsedParams) {
    notFound();
  }
  const { tenantId } = parsedParams;
  const pageFilters = parseMemberInvitationFilters(await searchParams);

  const [tenantResult, membersResult, invitationsResult, timeZone] =
    await Promise.all([
      getPlatformTenant(tenantId),
      listPlatformTenantMembers({
        tenantId,
        token: pageFilters.membersToken || undefined,
      }),
      listPlatformTenantAdminInvitations({
        limit: invitationPageSize,
        tenantId,
        token: pageFilters.token || undefined,
      }),
      getPlatformDisplayTimeZone(),
    ]);

  // Before both branches below: a rejected session reads every record as
  // missing, and a 404 would hide that the operator only needs to sign in again.
  await redirectToLoginIfSessionRejected(
    tenantResult,
    membersResult,
    invitationsResult
  );

  if (!tenantResult.ok) {
    return <TenantMembersLoadError message={tenantResult.message} />;
  }

  const { tenant } = tenantResult;
  if (!tenant) {
    notFound();
  }

  const previousHref = invitationsResult.previousToken
    ? buildMemberInvitationsPath(tenant.publicId, {
        membersToken: pageFilters.membersToken,
        token: invitationsResult.previousToken,
      })
    : undefined;
  const nextHref = invitationsResult.nextToken
    ? buildMemberInvitationsPath(tenant.publicId, {
        membersToken: pageFilters.membersToken,
        token: invitationsResult.nextToken,
      })
    : undefined;
  const membersPreviousHref = membersResult.previousToken
    ? buildMembersPath(tenant.publicId, {
        membersToken: membersResult.previousToken,
        token: pageFilters.token,
      })
    : undefined;
  const membersNextHref = membersResult.nextToken
    ? buildMembersPath(tenant.publicId, {
        membersToken: membersResult.nextToken,
        token: pageFilters.token,
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
            members={membersResult.members}
            membersErrorMessage={
              membersResult.ok ? undefined : membersResult.message
            }
            membersNextHref={membersNextHref}
            membersPreviousHref={membersPreviousHref}
            removeAction={removeTenantMemberAction}
            resendInvitationAction={resendTenantAdminInvitationAction}
            tenantId={tenant.publicId}
            timeZone={timeZone}
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
