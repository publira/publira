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

import { Message } from "#components/message";
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
} from "./_lib/search-params";

const invitationPageSize = 20;

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
const TenantMembersLoadError = ({ message }: { message: string }) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        <Suspense fallback="…">
          <Message message="platform.common.back_to_list" />
        </Suspense>
      </LinkButton>
    }
    description={message}
    title={
      <Suspense fallback="…">
        <Message message="platform.tenants.members_load_failed" />
      </Suspense>
    }
  />
);

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
