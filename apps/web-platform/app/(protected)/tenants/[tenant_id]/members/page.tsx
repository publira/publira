import { LinkButton } from "@publira/ui-components/button";
import { Card, CardContent, CardHeader } from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import { getMessage } from "@publira/utils/i18n";
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
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import {
  getInvitationStatusLabel,
  getTenantRoleLabel,
  getTenantStatusLabel,
} from "#lib/tenant-labels";
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
import type { TenantMembersManagerCopy } from "./_components/tenant-members-manager";
import {
  buildMemberInvitationsPath,
  buildMembersPath,
  parseMemberInvitationFilters,
} from "./_lib/search-params";

const invitationPageSize = 20;
const memberRoleValues = [
  "tenant_admin",
  "tenant_editor",
  "tenant_auditor",
] as const;
const tenantRoleValues = [
  "tenant_admin",
  "tenant_auditor",
  "tenant_editor",
  "tenant_member",
  "tenant_owner",
] as const;
const tenantStatusValues = [
  "active",
  "inactive",
  "suspended",
  "trial",
] as const;
const invitationStatusValues = [
  "accepted",
  "canceled",
  "expired",
  "pending",
] as const;

type TenantMembersPageProps = PageProps<"/tenants/[tenant_id]/members">;

const tenantMembersParamsSchema = z.object({
  tenant_id: routeParamString(),
});

export const generateMetadata = async ({
  params,
}: TenantMembersPageProps): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const parsedParams = parseRouteParams(
    tenantMembersParamsSchema,
    await params
  );
  if (!parsedParams) {
    return { title: getMessage(messages, "platform.tenants.members_heading") };
  }

  const tenantResult = await getPlatformTenant(parsedParams.tenant_id, locale);
  const name =
    tenantResult.ok && tenantResult.tenant ? tenantResult.tenant.name : "";

  return {
    title: name
      ? getMessage(messages, "platform.tenants.members_title", { name })
      : getMessage(messages, "platform.tenants.members_heading"),
  };
};

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
const TenantMembersLoadError = ({
  message,
  messages,
}: {
  message: string;
  messages: PlatformMessages;
}) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        {getMessage(messages, "platform.common.back_to_list")}
      </LinkButton>
    }
    description={message}
    title={getMessage(messages, "platform.tenants.members_load_failed")}
  />
);

const buildMembersManagerCopy = (
  messages: PlatformMessages
): TenantMembersManagerCopy => ({
  addDescription: getMessage(
    messages,
    "platform.tenants.add_member_description"
  ),
  addEmailLabel: getMessage(messages, "platform.tenants.add_member_email"),
  addPending: getMessage(messages, "platform.tenants.add_member_pending"),
  addSubmit: getMessage(messages, "platform.tenants.add_member_submit"),
  addTitle: getMessage(messages, "platform.tenants.add_member"),
  cancel: getMessage(messages, "platform.common.cancel"),
  cancelInvite: getMessage(messages, "platform.tenants.cancel_invite"),
  cancelInviteAction: getMessage(
    messages,
    "platform.tenants.cancel_invite_action"
  ),
  cancelInviteDescription: getMessage(
    messages,
    "platform.tenants.cancel_invite_description"
  ),
  cancelInvitePending: getMessage(
    messages,
    "platform.tenants.cancel_invite_pending"
  ),
  cancelInviteTitle: getMessage(
    messages,
    "platform.tenants.cancel_invite_title"
  ),
  changeRole: getMessage(messages, "platform.tenants.change_role"),
  changeRoleSubmit: getMessage(messages, "platform.tenants.change_role_submit"),
  changeRoleUpdating: getMessage(
    messages,
    "platform.tenants.change_role_updating"
  ),
  deleteMember: getMessage(messages, "platform.tenants.delete_member"),
  deleteMemberAction: getMessage(
    messages,
    "platform.tenants.delete_member_action"
  ),
  deleteMemberDescription: getMessage(
    messages,
    "platform.tenants.delete_member_description"
  ),
  deleteMemberPending: getMessage(
    messages,
    "platform.tenants.delete_member_pending"
  ),
  deleteMemberTitle: getMessage(
    messages,
    "platform.tenants.delete_member_title"
  ),
  invitationStatusLabels: Object.fromEntries(
    invitationStatusValues.map((status) => [
      status,
      getInvitationStatusLabel(status, messages),
    ])
  ),
  invitationsAria: getMessage(
    messages,
    "platform.tenants.invitations_pagination_aria"
  ),
  invitationsDescription: getMessage(
    messages,
    "platform.tenants.invitations_description"
  ),
  invitationsEmpty: getMessage(messages, "platform.tenants.invitations_empty"),
  invitationsLoadFailed: getMessage(
    messages,
    "platform.tenants.invitations_load_failed"
  ),
  invitationsTitle: getMessage(messages, "platform.tenants.invitations_title"),
  inviteAdmin: getMessage(messages, "platform.tenants.invite_admin"),
  inviteAdminDescription: getMessage(
    messages,
    "platform.tenants.invite_admin_description"
  ),
  inviteAdminEmail: getMessage(messages, "platform.tenants.invite_admin_email"),
  inviteAdminPending: getMessage(
    messages,
    "platform.tenants.invite_admin_pending"
  ),
  inviteAdminTitle: getMessage(messages, "platform.tenants.invite_admin_title"),
  membersAria: getMessage(messages, "platform.tenants.members_pagination_aria"),
  membersColumnsActions: getMessage(
    messages,
    "platform.tenants.members_columns_actions"
  ),
  membersColumnsCreated: getMessage(
    messages,
    "platform.tenants.members_columns_created"
  ),
  membersColumnsEmail: getMessage(
    messages,
    "platform.tenants.members_columns_email"
  ),
  membersColumnsExpires: getMessage(
    messages,
    "platform.tenants.members_columns_expires"
  ),
  membersColumnsInvitedAt: getMessage(
    messages,
    "platform.tenants.members_columns_invited_at"
  ),
  membersColumnsName: getMessage(
    messages,
    "platform.tenants.members_columns_name"
  ),
  membersColumnsRole: getMessage(
    messages,
    "platform.tenants.members_columns_role"
  ),
  membersColumnsStatus: getMessage(
    messages,
    "platform.tenants.members_columns_status"
  ),
  membersEmpty: getMessage(messages, "platform.tenants.members_empty"),
  membersListDescription: getMessage(
    messages,
    "platform.tenants.members_list_description"
  ),
  membersListFailed: getMessage(
    messages,
    "platform.tenants.members_load_failed"
  ),
  membersListTitle: getMessage(messages, "platform.tenants.members_list_title"),
  newRole: getMessage(messages, "platform.tenants.new_role"),
  next: getMessage(messages, "platform.common.next"),
  previous: getMessage(messages, "platform.common.previous"),
  resendInvite: getMessage(messages, "platform.tenants.resend_invite"),
  role: getMessage(messages, "platform.common.role"),
  roleLabels: Object.fromEntries(
    tenantRoleValues.map((role) => [role, getTenantRoleLabel(role, messages)])
  ),
  roleOptions: memberRoleValues.map((value) => ({
    label: getTenantRoleLabel(value, messages),
    value,
  })),
  roleUpdateDescription: getMessage(
    messages,
    "platform.tenants.role_update_description"
  ),
  statusLabels: Object.fromEntries(
    tenantStatusValues.map((status) => [
      status,
      getTenantStatusLabel(status, messages),
    ])
  ),
  unset: getMessage(messages, "platform.common.unset"),
});

const TenantMembersContent = async ({
  params,
  searchParams,
}: Pick<TenantMembersPageProps, "params" | "searchParams">) => {
  const parsedParams = parseRouteParams(
    tenantMembersParamsSchema,
    await params
  );
  if (!parsedParams) {
    notFound();
  }
  const { tenant_id: tenantId } = parsedParams;
  const pageFilters = parseMemberInvitationFilters(await searchParams);
  const locale = await getPlatformLocale();

  const [messages, tenantResult, membersResult, invitationsResult, timeZone] =
    await Promise.all([
      loadPlatformMessages(locale),
      getPlatformTenant(tenantId, locale),
      listPlatformTenantMembers({
        locale,
        tenantId,
        token: pageFilters.membersToken || undefined,
      }),
      listPlatformTenantAdminInvitations({
        limit: invitationPageSize,
        locale,
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
    return (
      <TenantMembersLoadError
        message={tenantResult.message}
        messages={messages}
      />
    );
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
          <PlatformPageTitle>
            {getMessage(messages, "platform.tenants.members_title", {
              name: tenant.name,
            })}
          </PlatformPageTitle>
          <PlatformPageDescription>
            {getMessage(messages, "platform.tenants.members_description")}
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            {getMessage(messages, "platform.common.back_to_list")}
          </LinkButton>
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-6">
          <TenantSectionNav
            current="members"
            labels={{
              basic: getMessage(messages, "platform.tenants.section_basic"),
              members: getMessage(messages, "platform.tenants.members_nav"),
            }}
            tenantId={tenant.publicId}
          />

          <TenantMembersManager
            addAction={addTenantMemberAction}
            cancelInvitationAction={cancelTenantAdminInvitationAction}
            copy={buildMembersManagerCopy(messages)}
            createInvitationAction={createTenantAdminInvitationAction}
            invitationErrorMessage={
              invitationsResult.ok ? undefined : invitationsResult.message
            }
            invitations={invitationsResult.invitations}
            invitationsNextHref={nextHref}
            invitationsPreviousHref={previousHref}
            locale={locale}
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
