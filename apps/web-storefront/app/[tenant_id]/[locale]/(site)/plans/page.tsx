import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getMessages } from "#lib/get-messages";
import { getPageAlternates } from "#lib/page-alternates";

import { PlanList } from "./_components/plan-list";
import { PlansNotice } from "./_components/plans-notice";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const [t, alternates] = await Promise.all([
    getMessages(),
    getPageAlternates("/plans"),
  ]);

  return { alternates, title: t("storefront.plans.title") };
};

/** As many cards as a site usually offers, while the read comes back. */
const PlanListSkeleton = () => (
  <div className="grid gap-6">
    {Array.from({ length: 2 }, (_, index) => (
      <div className="grid gap-3 border border-border bg-card p-6" key={index}>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-32 rounded-control" />
      </div>
    ))}
  </div>
);

/**
 * The plans the tenant sells: what each costs, what it opens, and the control
 * that subscribes to it. A reader reaches it from the gate of an episode a
 * plan opens and from My Page, and comes back to it when they leave Stripe's
 * checkout without paying.
 */
const PlansPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/plans">) => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="storefront.plans.title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <Message message="storefront.plans.description" />
        </Suspense>
      </p>
    </div>

    <Suspense fallback={null}>
      <PlansNotice searchParams={searchParams} />
    </Suspense>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="storefront.plans.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<PlanListSkeleton />}>
        <PlanList />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default PlansPage;
