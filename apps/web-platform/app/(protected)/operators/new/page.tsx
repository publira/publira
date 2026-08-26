import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";

import { CreateOperatorForm } from "./_components/create-operator-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.operators.add_title") };
};

const OperatorNewPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>Platform Governance</PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-44" />}>
            <Message message="platform.operators.add_title" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.operators.add_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
      <PlatformPageActions>
        <LinkButton render={<Link href="/operators" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.common.back_to_list" />
          </Suspense>
        </LinkButton>
      </PlatformPageActions>
    </PlatformPageHeader>
    <PlatformPageContent>
      <Card>
        <CardHeader>
          <CardTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
              <Message message="platform.operators.form_title" />
            </Suspense>
          </CardTitle>
          <CardDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="platform.operators.form_description" />
            </Suspense>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <CreateOperatorForm />
          </Suspense>
        </CardContent>
      </Card>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorNewPage;
