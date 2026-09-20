import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
  PlatformSection,
} from "#components/platform-page";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformPolicy } from "#lib/platform-policy";
import type { PlatformSecurityPolicy } from "#lib/platform-policy";

import { SettingsNavigation } from "../_components/settings-navigation";
import { SecurityPolicyForm } from "./_components/security-policy-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.policy.security.page_title") };
};

const emptyValues: PlatformSecurityPolicy = {
  mailRequestsPerAddress: { perDay: 1, perHour: 1 },
  mailRequestsPerSource: { perDay: 1, perHour: 1 },
  mfaRequiredForTenantAdmin: false,
  passwordVerification: { perDay: 1, perMinute: 1 },
};

const FormSkeleton = () => (
  <PlatformSection>
    <SkeletonLine className="h-6 w-32" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
  </PlatformSection>
);

const Content = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformPolicy(locale);
  await redirectToLoginIfSessionRejected(result);
  return (
    <SecurityPolicyForm
      loadErrorMessage={result.ok ? undefined : result.message}
      revision={result.ok ? result.revision : "0"}
      values={result.ok ? result.values.security : emptyValues}
    />
  );
};

const SecurityPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-24" />}>
            <Message message="platform.policy.security.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.security.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsNavigation current="security" />
        <Suspense fallback={<FormSkeleton />}>
          <Content />
        </Suspense>
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default SecurityPage;
