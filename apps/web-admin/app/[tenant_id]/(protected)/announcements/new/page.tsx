import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { findTenantLocales } from "#lib/tenant-locales";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { AnnouncementForm } from "../_components/announcement-form";
import { createAnnouncementAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isEditor
      ? t("admin.announcements.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const AnnouncementFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-10" />
    <Skeleton className="h-28" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-32" />
  </div>
);

const AnnouncementFormData = async () => {
  const tenantId = await getTenantId();

  const [tenantLocales, timeZone] = await Promise.all([
    findTenantLocales(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  return (
    <AnnouncementForm
      action={createAnnouncementAction}
      tenantId={tenantId}
      tenantLocales={tenantLocales}
      timeZone={timeZone}
    />
  );
};

const NewAnnouncementPage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.announcements.new_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.announcements.new_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/announcements" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.announcements.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<AnnouncementFormSkeleton />}>
            <AnnouncementFormData />
          </Suspense>
        </ConsolePage.Content>
      </TenantEditorRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default NewAnnouncementPage;
