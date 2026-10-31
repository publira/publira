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
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getCreator } from "#lib/creator";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CreatorForm } from "../_components/creator-form";
import { updateCreatorAction } from "../_lib/actions";
import { CreatorAccounts } from "./_components/creator-accounts";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.creators.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_id");

const EditCreatorFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-32" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

interface EditCreatorPageProps {
  params: Promise<{
    creator_id: string;
    tenant_id: string;
  }>;
}

const editCreatorParamsSchema = z.object({
  creator_id: routeParamString(),
});

const EditCreatorFormData = async ({
  params,
}: Pick<EditCreatorPageProps, "params">) => {
  const parsedParams = parseRouteParams(editCreatorParamsSchema, await params);

  if (!parsedParams) {
    notFound();
  }

  const { creator_id: creatorPublicId } = parsedParams;

  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const result = await getCreator(
    {
      publicId: creatorPublicId,
      tenantId,
    },
    locale
  );

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's creator — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Message message="admin.creators.detail_error" />
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton render={<Link href="/creators" />} variant="outline">
            <Message message="admin.creators.back_to_list" />
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  return (
    <CreatorForm
      action={updateCreatorAction}
      initialCreator={result.creator}
      key={result.creator.publicId}
      mode="update"
      tenantId={tenantId}
    />
  );
};

/**
 * The reader accounts linked to the creator. Only a tenant admin may read or
 * change them, so every other role is shown nothing here; a creator that could
 * not be read is already reported by the form above.
 */
const CreatorAccountsSection = async ({
  params,
}: Pick<EditCreatorPageProps, "params">) => {
  const parsedParams = parseRouteParams(editCreatorParamsSchema, await params);

  if (!parsedParams) {
    return null;
  }

  const tenantId = await getTenantId();
  const currentUser = await getAdminCurrentUser(tenantId);

  if (!currentUser.ok || !isTenantAdminRole(currentUser.user.role)) {
    return null;
  }

  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    getCreator({ publicId: parsedParams.creator_id, tenantId }, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return null;
  }

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
              <Message message="admin.creators.accounts.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message message="admin.creators.accounts.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <CreatorAccounts
        accounts={result.accounts}
        creatorId={result.creator.id}
        creatorPublicId={result.creator.publicId}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    </ConsoleSection.Root>
  );
};

const EditCreatorPage = ({ params }: EditCreatorPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.creators.edit_title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.creators.edit_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <LinkButton render={<Link href="/creators" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.creators.back_to_list" />
          </Suspense>
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <FlashToast message="admin.creators.created" />
      <ConsoleSection.Stack>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<EditCreatorFormSkeleton />}>
            <TenantEditorFieldset>
              <EditCreatorFormData params={params} />
            </TenantEditorFieldset>
          </Suspense>
        </SectionErrorBoundary>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.accounts.list_error" />
            </Suspense>
          }
        >
          <Suspense fallback={null}>
            <CreatorAccountsSection params={params} />
          </Suspense>
        </SectionErrorBoundary>
      </ConsoleSection.Stack>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default EditCreatorPage;
