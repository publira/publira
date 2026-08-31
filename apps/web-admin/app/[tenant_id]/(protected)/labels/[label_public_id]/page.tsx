import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { parseEditTab } from "#lib/edit-tab-search-params";
import { getLabel } from "#lib/label";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { LabelEyeCatchForm } from "../_components/label-eye-catch-form";
import { LabelForm } from "../_components/label-form";
import { LabelTabNav } from "../_components/label-tab-nav";
import { updateLabelAction } from "../_lib/actions";

interface EditLabelPageProps {
  params: Promise<{
    label_public_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

const editLabelParamsSchema = z.object({
  label_public_id: routeParamString(),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.labels.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "label_public_id");

const EditLabelFormSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="grid gap-4">
      <div className="h-20 animate-pulse rounded bg-muted/70" />
      <div className="ml-auto h-10 w-36 animate-pulse rounded bg-muted" />
    </div>
  </div>
);

const resolveActiveTab = async (
  searchParams: EditLabelPageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => parseEditTab(await searchParams);

const EditLabelTitle = async ({
  searchParams,
}: Pick<EditLabelPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.labels.eye_catch_title" />
  ) : (
    <Message message="admin.labels.edit_title" />
  );
};

const EditLabelDescription = async ({
  searchParams,
}: Pick<EditLabelPageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.labels.eye_catch_description" />
  ) : (
    <Message message="admin.labels.edit_description" />
  );
};

const EditLabelTabNav = async ({
  params,
  searchParams,
}: EditLabelPageProps) => {
  const [rawParams, activeTab] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
  ]);
  const parsedParams = parseRouteParams(editLabelParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { label_public_id: labelPublicId } = parsedParams;

  return <LabelTabNav current={activeTab} labelId={labelPublicId} />;
};

const EditLabelFormData = async ({
  params,
  searchParams,
}: EditLabelPageProps) => {
  const [rawParams, activeTab, tenantId] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(editLabelParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { label_public_id: labelPublicId } = parsedParams;

  const locale = await getLocale(tenantId);
  const result = await getLabel(
    {
      publicId: labelPublicId,
      tenantId,
    },
    locale
  );

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's label — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError
        actions={
          <LinkButton render={<Link href="/labels" />} variant="outline">
            <Message message="admin.labels.back_to_list" />
          </LinkButton>
        }
        description={result.message}
        title={<Message message="admin.labels.detail_error" />}
      />
    );
  }

  if (activeTab === "eye-catch") {
    return (
      <LabelEyeCatchForm
        action={updateLabelAction}
        initialLabel={result.label}
      />
    );
  }

  return (
    <LabelForm
      action={updateLabelAction}
      initialLabel={result.label}
      mode="update"
    />
  );
};

const EditLabelPage = ({ params, searchParams }: EditLabelPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
            <EditLabelTitle searchParams={searchParams} />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <EditLabelDescription searchParams={searchParams} />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/labels" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.labels.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast message="admin.labels.created" />
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
          <EditLabelTabNav params={params} searchParams={searchParams} />
        </Suspense>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.labels.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<EditLabelFormSkeleton />}>
            <EditLabelFormData params={params} searchParams={searchParams} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditLabelPage;
