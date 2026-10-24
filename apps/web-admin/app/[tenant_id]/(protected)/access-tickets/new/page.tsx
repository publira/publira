import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { TicketForm } from "#components/access-ticket-form";
import { Message } from "#components/message";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { issueAccessTicketAction } from "#lib/access-ticket-actions";
import { isSignedInTenantAdmin } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listAllSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.access_tickets.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewAccessTicketFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-20" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const NewAccessTicketFormData = async () => {
  const tenantId = await getTenantId();
  const [timeZone, seriesResult] = await Promise.all([
    getTenantDisplayTimeZone(tenantId),
    listAllSeries(),
  ]);

  return (
    <TicketForm
      action={issueAccessTicketAction}
      series={seriesResult.series.map((item) => ({
        id: item.id,
        publicId: item.publicId,
        title: item.title,
      }))}
      seriesErrorMessage={seriesResult.ok ? undefined : seriesResult.message}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const NewAccessTicketPage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.access_tickets.new_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.access_tickets.new_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/access-tickets" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.access_tickets.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<NewAccessTicketFormSkeleton />}>
            <NewAccessTicketFormData />
          </Suspense>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default NewAccessTicketPage;
