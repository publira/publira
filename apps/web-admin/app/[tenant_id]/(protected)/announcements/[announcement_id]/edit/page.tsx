import * as ConsolePage from "@publira/layouts/admin/console-page";
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

import { Message } from "#components/message";
import {
  TenantEditorRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { getAnnouncement } from "#lib/announcement";
import {
  isSignedInTenantEditor,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { AnnouncementDeleteButton } from "../../_components/announcement-delete-button";
import { AnnouncementFormData } from "../../_components/announcement-form-data";
import { updateAnnouncementAction } from "../../_lib/actions";

type EditAnnouncementPageProps =
  PageProps<"/[tenant_id]/announcements/[announcement_id]/edit">;

const editAnnouncementParamsSchema = z.object({
  announcement_id: routeParamString().pipe(z.uuid()),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isEditor] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantEditor(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isEditor
      ? t("admin.announcements.edit_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "announcement_id");

const EditAnnouncementFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-10" />
    <Skeleton className="h-28" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-32" />
  </div>
);

const EditAnnouncementFormData = async ({
  params,
}: Pick<EditAnnouncementPageProps, "params">) => {
  const [rawParams, tenantId] = await Promise.all([params, getTenantId()]);

  const parsedParams = parseRouteParams(
    editAnnouncementParamsSchema,
    rawParams
  );

  if (!parsedParams) {
    notFound();
  }

  const locale = await getLocale(tenantId);

  const result = await getAnnouncement(
    { announcementId: parsedParams.announcement_id, tenantId },
    locale
  );

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Message message="admin.announcements.list_error" />
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  // One that has gone out is what its readers were pointed at, and is edited
  // no more: it has no screen of its own, as one that does not exist has none.
  if (!result.announcement || result.announcement.deliveredAt) {
    notFound();
  }

  return (
    <div className="grid gap-8" key={result.announcement.id}>
      <AnnouncementFormData
        action={updateAnnouncementAction}
        announcement={result.announcement}
        tenantId={tenantId}
      />
      <div className="border-t border-border pt-5">
        <AnnouncementDeleteButton
          announcement={result.announcement}
          tenantId={tenantId}
        />
      </div>
    </div>
  );
};

const EditAnnouncementPage = ({ params }: EditAnnouncementPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantEditorRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
                <Message message="admin.announcements.edit_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.announcements.edit_description" />
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
          <Suspense fallback={<EditAnnouncementFormSkeleton />}>
            <EditAnnouncementFormData params={params} />
          </Suspense>
        </ConsolePage.Content>
      </TenantEditorRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default EditAnnouncementPage;
