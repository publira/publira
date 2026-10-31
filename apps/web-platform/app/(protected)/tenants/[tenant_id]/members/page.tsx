import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
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
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import {
  getPlatformTenant,
  listPlatformTenantAdminInvitations,
  listPlatformTenantMembers,
} from "#lib/tenants";

import { TenantSectionNav } from "../_components/tenant-section-nav";
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
  const t = await getMessagesFor(locale);

  const parsedParams = parseRouteParams(
    tenantMembersParamsSchema,
    await params
  );

  if (!parsedParams) {
    return { title: t("platform.tenants.members_heading") };
  }

  const tenantResult = await getPlatformTenant(parsedParams.tenant_id);

  const name =
    tenantResult.ok && tenantResult.tenant ? tenantResult.tenant.name : "";

  return {
    title: name
      ? t("platform.tenants.members_title", { name })
      : t("platform.tenants.members_heading"),
  };
};

const TenantMembersSkeleton = () => (
  <ConsolePage.Content>
    <div className="grid gap-6">
      <Skeleton className="h-10 w-64" />
      <ConsoleSection.Root>
        <SkeletonLine className="h-5 w-40" />
        <Table.Skeleton />
      </ConsoleSection.Root>
    </div>
  </ConsolePage.Content>
);

/**
 * A read that failed is not a tenant that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for a tenant that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const TenantMembersLoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Suspense fallback="…">
          <Message message="platform.tenants.members_load_failed" />
        </Suspense>
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        <Suspense fallback="…">
          <Message message="platform.common.back_to_list" />
        </Suspense>
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
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

  const [locale, tenantResult, timeZone] = await Promise.all([
    getPlatformLocale(),
    getPlatformTenant(tenantId),
    getPlatformDisplayTimeZone(),
  ]);

  if (!tenantResult.ok) {
    return <TenantMembersLoadError message={tenantResult.message} />;
  }

  const { tenant } = tenantResult;

  if (!tenant) {
    notFound();
  }

  const [membersResult, invitationsResult] = await Promise.all([
    listPlatformTenantMembers({
      tenantId: tenant.id,
      token: pageFilters.membersToken || undefined,
    }),
    listPlatformTenantAdminInvitations({
      limit: invitationPageSize,
      tenantId: tenant.id,
      token: pageFilters.token || undefined,
    }),
  ]);

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
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
              <Message
                message="platform.tenants.members_title"
                values={{ name: tenant.name }}
              />
            </Suspense>
          </ConsolePage.Title>
          <ConsolePage.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <Message message="platform.tenants.members_description" />
            </Suspense>
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ConsolePage.Content>
        <div className="grid gap-6">
          <TenantSectionNav current="members" tenantId={tenant.publicId} />

          <TenantMembersManager
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
            tenantId={tenant.id}
            timeZone={timeZone}
          />
        </div>
      </ConsolePage.Content>
    </>
  );
};

// `ConsolePage.Root` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const TenantMembersPage = ({
  params,
  searchParams,
}: TenantMembersPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantMembersSkeleton />}>
      <TenantMembersContent params={params} searchParams={searchParams} />
    </Suspense>
  </ConsolePage.Root>
);

export default TenantMembersPage;
