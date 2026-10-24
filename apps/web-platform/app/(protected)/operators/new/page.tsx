import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

import { CreateOperatorForm } from "./_components/create-operator-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.operators.add_title") };
};

const OperatorNewPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-44" />}>
            <Message message="platform.operators.add_title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="platform.operators.add_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <LinkButton render={<Link href="/operators" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.common.back_to_list" />
          </Suspense>
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <CreateOperatorForm />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default OperatorNewPage;
