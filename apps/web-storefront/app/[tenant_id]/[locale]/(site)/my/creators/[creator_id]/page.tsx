import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { creatorIdParamSchema, creatorPageHref } from "#lib/creator-page-paths";
import { listMyCreators } from "#lib/creator-pages";
import { cursorTokenSchema } from "#lib/cursor-token";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { CreatorHeading } from "../_components/creator-heading";
import {
  CreatorStatements,
  CreatorStatementsSkeleton,
} from "./_components/creator-statements";
import {
  CreatorStats,
  CreatorStatsSkeleton,
} from "./_components/creator-stats";
import { CreatorTabs } from "./_components/creator-tabs";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.my_creator.title") };
};

type CreatorPageProps =
  PageProps<"/[tenant_id]/[locale]/my/creators/[creator_id]">;

/** The cursors of the page's two lists: the episodes and the closed months. */
const searchParamsSchema = z.object({
  statements: cursorTokenSchema,
  token: cursorTokenSchema,
});

const CreatorPageSkeleton = () => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <SkeletonLine className="h-6 w-48" />
      <SkeletonLine className="mt-2 h-4 w-72" />
    </section>
    <Skeleton className="h-64 w-full" />
  </div>
);

/**
 * One Author's page. The Authors the account is linked to are read first, since
 * they say both which Author the path may name and whether the tenant shows
 * their sales, and the figures and the closed months then read inside their
 * own boundaries, so a failing one costs the page that section alone.
 */
const CreatorPageContent = async ({
  params,
  searchParams,
}: CreatorPageProps) => {
  const [{ creator_id }, resolvedSearchParams, tenantId, locale] =
    await Promise.all([params, searchParams, getTenantId(), getLocale()]);

  const creatorId = creatorIdParamSchema.safeParse(creator_id);

  if (!creatorId.success) {
    notFound();
  }

  const { statements: statementsToken, token } =
    searchParamsSchema.parse(resolvedSearchParams);

  const result = await listMyCreators(tenantId, locale);

  if (!result.ok && result.missing) {
    notFound();
  }

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(
      locale,
      creatorPageHref(creatorId.data, { statementsToken, token }),
      tenantId
    );
  }

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const { creators, salesVisible } = result.value;
  const creator = creators.find(({ id }) => id === creatorId.data);

  if (!creator) {
    notFound();
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="grid gap-4 border border-border bg-card p-6">
        <CreatorTabs creators={creators} currentId={creator.id} />
        <CreatorHeading creator={creator}>
          <h1 className="text-xl font-semibold">{creator.name}</h1>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.my_creator.description" />
            </Suspense>
          </p>
        </CreatorHeading>
      </section>

      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my_creator.stats_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<CreatorStatsSkeleton />}>
          <CreatorStats
            creatorId={creator.id}
            locale={locale}
            salesVisible={salesVisible}
            statementsToken={statementsToken}
            tenantId={tenantId}
            token={token}
          />
        </Suspense>
      </SectionErrorBoundary>

      {salesVisible ? (
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.my_creator.statements_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<CreatorStatementsSkeleton />}>
            <CreatorStatements
              creatorId={creator.id}
              episodesToken={token}
              locale={locale}
              tenantId={tenantId}
              token={statementsToken}
            />
          </Suspense>
        </SectionErrorBoundary>
      ) : null}

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/my"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.my.title" />
          </Suspense>
        </LocaleLink>
      </p>
    </div>
  );
};

const CreatorPage = (props: CreatorPageProps) => (
  <Suspense fallback={<CreatorPageSkeleton />}>
    <CreatorPageContent {...props} />
  </Suspense>
);

export default CreatorPage;
