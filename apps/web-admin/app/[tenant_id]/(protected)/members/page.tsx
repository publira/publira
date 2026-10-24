import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import {
  listTenantAdminInvitations,
  listTenantMembers,
} from "#lib/tenant-members";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { InvitationList } from "./_components/invitation-list";
import { MemberInviteForm } from "./_components/member-invite-form";
import { MemberList } from "./_components/member-list";
import {
  invitationPageHrefs,
  memberPageHrefs,
  parseMembersSearchParams,
} from "./_lib/search-params";

type MembersPageProps = PageProps<"/[tenant_id]/members">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin ? t("admin.members.title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const MemberListData = async ({
  searchParams,
}: Pick<MembersPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const pageParams = parseMembersSearchParams(sp);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const listResult = await listTenantMembers(tenantId, locale, {
    token: pageParams.membersToken,
  });

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <MemberList
      {...memberPageHrefs(pageParams, listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      members={listResult.members}
      pageSize={DEFAULT_PAGE_SIZE}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const InvitationListData = async ({
  searchParams,
}: Pick<MembersPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const pageParams = parseMembersSearchParams(sp);
  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const listResult = await listTenantAdminInvitations(tenantId, locale, {
    token: pageParams.invitationsToken,
  });

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <InvitationList
      {...invitationPageHrefs(pageParams, listResult)}
      invitations={listResult.invitations}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const MemberInviteFormData = async () => {
  const tenantId = await getTenantId();

  return <MemberInviteForm tenantId={tenantId} />;
};

const MembersPage = ({ searchParams }: MembersPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.members.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.members.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <ConsoleSection.Stack>
            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                      <Message message="admin.members.invite_title" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.invite_description" />
                    </Suspense>
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <Suspense fallback={<Skeleton className="h-24" />}>
                <MemberInviteFormData />
              </Suspense>
            </ConsoleSection.Root>

            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-6 w-28" />}>
                      <Message message="admin.members.list_title" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.list_description" />
                    </Suspense>
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
                    <Message message="admin.members.list_error" />
                  </Suspense>
                }
              >
                <Suspense fallback={<Table.Skeleton />}>
                  <MemberListData searchParams={searchParams} />
                </Suspense>
              </SectionErrorBoundary>
            </ConsoleSection.Root>

            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                      <Message message="admin.members.invitations_title" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.invitations_description" />
                    </Suspense>
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
                    <Message message="admin.members.invitations_error" />
                  </Suspense>
                }
              >
                <Suspense fallback={<Table.Skeleton />}>
                  <InvitationListData searchParams={searchParams} />
                </Suspense>
              </SectionErrorBoundary>
            </ConsoleSection.Root>
          </ConsoleSection.Stack>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default MembersPage;
