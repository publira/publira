import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
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
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSections,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
  verifyAdminSession,
} from "#lib/auth-session";
import {
  getContactMessage,
  listContactMessageAssignees,
} from "#lib/contact-message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ContactMessageAssignment } from "./_components/contact-message-assignment";
import { ContactMessageDetail } from "./_components/contact-message-detail";
import { ContactMessageExchange } from "./_components/contact-message-exchange";
import { ContactMessageStaffNote } from "./_components/contact-message-staff-note";

type ContactMessageDetailPageProps =
  PageProps<"/[tenant_id]/contact-messages/[contact_message_id]">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.contact_messages.detail_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "contact_message_id");

const contactMessageParamsSchema = z.object({
  contact_message_id: routeParamString(),
});

const DetailSkeleton = () => (
  <AdminSection>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-64" />
  </AdminSection>
);

const ContactMessageDetailContent = async ({
  params,
}: Pick<ContactMessageDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(
    contactMessageParamsSchema,
    await params
  );
  if (!parsedParams) {
    notFound();
  }
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [result, timeZone, assigneesResult, currentUser] = await Promise.all([
    getContactMessage(tenantId, locale, parsedParams.contact_message_id),
    getTenantDisplayTimeZone(tenantId),
    listContactMessageAssignees(tenantId, locale),
    verifyAdminSession(tenantId),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      // Missing and another tenant's message alike — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.contact_messages.detail_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <LinkButton
            render={<Link href="/contact-messages" />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.contact_messages.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionErrorActions>
      </SectionError>
    );
  }

  await redirectToLoginIfSessionRejected(assigneesResult);

  return (
    <AdminSections>
      <ContactMessageDetail
        contactMessage={result.contactMessage}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />
      <ContactMessageExchange
        contactMessage={result.contactMessage}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />
      <ContactMessageAssignment
        assignees={assigneesResult.assignees}
        assigneesErrorMessage={
          assigneesResult.ok ? undefined : assigneesResult.message
        }
        contactMessage={result.contactMessage}
        currentUserPublicId={currentUser.publicId}
        locale={locale}
        tenantId={tenantId}
      />
      <ContactMessageStaffNote
        contactMessage={result.contactMessage}
        tenantId={tenantId}
      />
    </AdminSections>
  );
};

const ContactMessageDetailPage = ({
  params,
}: ContactMessageDetailPageProps) => (
  <AdminPage>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageTitle>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.contact_messages.detail_title" />
              </Suspense>
            </AdminPageTitle>
            <AdminPageDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.contact_messages.detail_description" />
              </Suspense>
            </AdminPageDescription>
          </AdminPageHeading>
          <AdminPageActions>
            <LinkButton
              render={<Link href="/contact-messages" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.contact_messages.back_to_list" />
              </Suspense>
            </LinkButton>
          </AdminPageActions>
        </AdminPageHeader>
        <AdminPageContent>
          <FlashToast
            keyName="handled"
            message="admin.contact_messages.marked_handled"
          />
          <FlashToast
            keyName="replied"
            message="admin.contact_messages.reply.sent"
          />
          <FlashToast
            keyName="reopened"
            message="admin.contact_messages.reopened"
          />
          <FlashToast
            keyName="assigned"
            message="admin.contact_messages.assignment.assigned"
          />
          <FlashToast
            keyName="unassigned"
            message="admin.contact_messages.assignment.unassigned"
          />
          <FlashToast
            keyName="note_saved"
            message="admin.contact_messages.staff_note.saved"
          />
          <FlashToast
            keyName="note_cleared"
            message="admin.contact_messages.staff_note.cleared"
          />
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.contact_messages.detail_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<DetailSkeleton />}>
              <ContactMessageDetailContent params={params} />
            </Suspense>
          </SectionErrorBoundary>
        </AdminPageContent>
      </TenantAdminRoute>
    </Suspense>
  </AdminPage>
);

export default ContactMessageDetailPage;
