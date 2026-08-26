import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Select } from "@publira/ui-components/select";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
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
import { getOperatorRoleSelectItems } from "#lib/operator-labels";

import { CreateOperatorForm } from "./_components/create-operator-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.operators.add_title") };
};

/**
 * `placeholder` is an attribute, so it cannot be a suspended node the way a
 * label can. The control that carries one therefore waits on the catalog
 * itself, behind a boundary the size of the select.
 */
const OperatorRoleSelect = async () => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return (
    <Select
      id="operator_role"
      items={getOperatorRoleSelectItems(messages)}
      name="operator_role"
      placeholder={getMessage(messages, "platform.common.select_placeholder")}
      required
    />
  );
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
          <CreateOperatorForm
            copy={{
              cancelLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.operators.cancel" />
                </Suspense>
              ),
              emailLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="platform.common.email" />
                </Suspense>
              ),
              nameLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.common.name" />
                </Suspense>
              ),
              pendingLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="platform.common.adding" />
                </Suspense>
              ),
              roleLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="platform.common.role" />
                </Suspense>
              ),
              submitLabel: (
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.add" />
                </Suspense>
              ),
            }}
            roleSelect={
              <Suspense fallback={<Skeleton className="h-10 w-full" />}>
                <OperatorRoleSelect />
              </Suspense>
            }
          />
        </CardContent>
      </Card>
    </PlatformPageContent>
  </PlatformPage>
);

export default OperatorNewPage;
