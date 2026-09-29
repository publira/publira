import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  AdminPageContent,
  AdminPage,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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

const isSignedInTenantAdmin = async (tenantId: string): Promise<boolean> => {
  const result = await getAdminCurrentUser(tenantId);
  await redirectToLoginIfSessionRejected(result);

  return result.ok && isTenantAdminRole(result.user.role);
};

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

/**
 * Renders the screen for a tenant admin and answers not found to every other
 * role, so an editor or an auditor cannot tell the route from one that does
 * not exist. Nothing of the screen is painted before the role is known.
 */
const TenantAdminOnly = async ({ children }: { children: ReactNode }) => {
  const tenantId = await getTenantId();
  if (!(await isSignedInTenantAdmin(tenantId))) {
    notFound();
  }

  return children;
};

const MembersPageSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-2">
      <SkeletonLine className="h-7 w-32" />
      <SkeletonLine className="h-4 w-80" />
    </div>
    <TableSkeleton />
  </div>
);

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
  <AdminPage>
    <Suspense fallback={<MembersPageSkeleton />}>
      <TenantAdminOnly>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.members.title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.members.page_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
        </AdminPageHeader>
        <AdminPageContent>
          <AdminSections>
            <AdminSection>
              <AdminSectionHeader>
                <AdminSectionHeading>
                  <AdminSectionTitle>
                    <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                      <Message message="admin.members.invite_title" />
                    </Suspense>
                  </AdminSectionTitle>
                  <AdminSectionDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.invite_description" />
                    </Suspense>
                  </AdminSectionDescription>
                </AdminSectionHeading>
              </AdminSectionHeader>
              <Suspense fallback={<Skeleton className="h-24" />}>
                <MemberInviteFormData />
              </Suspense>
            </AdminSection>

            <AdminSection>
              <AdminSectionHeader>
                <AdminSectionHeading>
                  <AdminSectionTitle>
                    <Suspense fallback={<SkeletonLine className="h-6 w-28" />}>
                      <Message message="admin.members.list_title" />
                    </Suspense>
                  </AdminSectionTitle>
                  <AdminSectionDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.list_description" />
                    </Suspense>
                  </AdminSectionDescription>
                </AdminSectionHeading>
              </AdminSectionHeader>
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
                    <Message message="admin.members.list_error" />
                  </Suspense>
                }
              >
                <Suspense fallback={<TableSkeleton />}>
                  <MemberListData searchParams={searchParams} />
                </Suspense>
              </SectionErrorBoundary>
            </AdminSection>

            <AdminSection>
              <AdminSectionHeader>
                <AdminSectionHeading>
                  <AdminSectionTitle>
                    <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                      <Message message="admin.members.invitations_title" />
                    </Suspense>
                  </AdminSectionTitle>
                  <AdminSectionDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                      <Message message="admin.members.invitations_description" />
                    </Suspense>
                  </AdminSectionDescription>
                </AdminSectionHeading>
              </AdminSectionHeader>
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
                    <Message message="admin.members.invitations_error" />
                  </Suspense>
                }
              >
                <Suspense fallback={<TableSkeleton />}>
                  <InvitationListData searchParams={searchParams} />
                </Suspense>
              </SectionErrorBoundary>
            </AdminSection>
          </AdminSections>
        </AdminPageContent>
      </TenantAdminOnly>
    </Suspense>
  </AdminPage>
);

export default MembersPage;
