import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
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
import { getTenantInboundEmailReadiness } from "#lib/inbound-email-settings";
import type { TenantInboundEmailReadinessResult } from "#lib/inbound-email-settings";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ContactMessageAssignment } from "./_components/contact-message-assignment";
import { ContactMessageDetail } from "./_components/contact-message-detail";
import { ContactMessageExchange } from "./_components/contact-message-exchange";
import type { ContactMessageReplyRoute } from "./_components/contact-message-reply-form";
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

const contactMessageReplyRoute = (
  result: TenantInboundEmailReadinessResult
): ContactMessageReplyRoute => {
  if (!result.ok) {
    return "unknown";
  }
  return result.ready ? "inbound" : "staff";
};

const DetailSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-64" />
  </ConsoleSection.Root>
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
  const [
    result,
    timeZone,
    assigneesResult,
    currentUser,
    inboundEmailReadinessResult,
  ] = await Promise.all([
    getContactMessage(tenantId, locale, parsedParams.contact_message_id),
    getTenantDisplayTimeZone(tenantId),
    listContactMessageAssignees(tenantId, locale),
    verifyAdminSession(tenantId),
    getTenantInboundEmailReadiness(tenantId, locale),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      // Missing and another tenant's message alike — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.contact_messages.detail_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton
            render={<Link href="/contact-messages" />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.contact_messages.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  await redirectToLoginIfSessionRejected(
    assigneesResult,
    inboundEmailReadinessResult
  );

  return (
    <ConsoleSection.Stack>
      <ContactMessageDetail
        contactMessage={result.contactMessage}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />
      <ContactMessageExchange
        contactMessage={result.contactMessage}
        locale={locale}
        replyRoute={contactMessageReplyRoute(inboundEmailReadinessResult)}
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
    </ConsoleSection.Stack>
  );
};

const ContactMessageDetailPage = ({
  params,
}: ContactMessageDetailPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.contact_messages.detail_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.contact_messages.detail_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/contact-messages" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.contact_messages.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default ContactMessageDetailPage;
