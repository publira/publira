import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminDomainPreview } from "#components/admin-domain-preview";
import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { CreateTenantForm } from "./_components/create-tenant-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.tenants.create_title") };
};

const CreateDomainCautions = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <TenantDomainCautions
      copy={{
        items: [
          getMessage(messages, "platform.tenants.caution_cache"),
          getMessage(messages, "platform.tenants.caution_unique"),
          getMessage(messages, "platform.tenants.caution_dns"),
        ],
        title: getMessage(messages, "platform.tenants.caution_title"),
      }}
    />
  );
};

const CreateAdminDomainPreview = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <AdminDomainPreview
      adminDomain=""
      copy={{
        current: getMessage(
          messages,
          "platform.tenants.admin_domain_preview_current"
        ),
        prefix: getMessage(
          messages,
          "platform.tenants.admin_domain_preview_prefix"
        ),
        set: getMessage(messages, "platform.tenants.admin_domain_preview_set"),
      }}
      showCurrentDomain={false}
    />
  );
};

const TenantNewPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.tenants.create_heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="platform.tenants.create_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <Card>
        <CardHeader>
          <CardTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="platform.tenants.create_form_title" />
            </Suspense>
          </CardTitle>
          <CardDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message message="platform.tenants.create_form_description" />
            </Suspense>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTenantForm
            copy={{
              adminDomainLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.tenants.admin_domain" />
                </Suspense>
              ),
              adminDomainPreview: (
                <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                  <CreateAdminDomainPreview />
                </Suspense>
              ),
              createDraft: (
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="platform.tenants.create_draft" />
                </Suspense>
              ),
              createPending: (
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.common.creating" />
                </Suspense>
              ),
              createSubmit: (
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.create" />
                </Suspense>
              ),
              domainCautions: (
                <Suspense
                  fallback={
                    <div className="h-24 animate-pulse rounded bg-muted/70" />
                  }
                >
                  <CreateDomainCautions />
                </Suspense>
              ),
              domainLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.tenants.domain" />
                </Suspense>
              ),
              initialAdminEmailsLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="platform.tenants.initial_admin_emails" />
                </Suspense>
              ),
              nameLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="platform.tenants.name" />
                </Suspense>
              ),
            }}
          />
        </CardContent>
      </Card>
    </PlatformPageContent>
  </PlatformPage>
);

export default TenantNewPage;
