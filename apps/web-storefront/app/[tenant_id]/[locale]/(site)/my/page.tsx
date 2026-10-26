import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";

import { CoinsSection } from "./_components/coins-section";
import {
  FollowUpdatesSection,
  FollowUpdatesSectionSkeleton,
} from "./_components/follow-updates";
import { MyNotice } from "./_components/my-notice";
import { ReadingHistorySection } from "./_components/reading-history";
import {
  RecommendedCreatorsSection,
  RecommendedCreatorsSkeleton,
  RecommendedSeriesSection,
  RecommendedSeriesSkeleton,
} from "./_components/recommendations";
import { SubscriptionSection } from "./_components/subscription-section";

type MyPageProps = PageProps<"/[tenant_id]/[locale]/my">;

/**
 * Each heading names its section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to. `/my` renders each of
 * them once, so the ids are constants rather than generated ones.
 */
const FOLLOW_UPDATES_HEADING_ID = "follow-updates-heading";
const RECOMMENDED_HEADING_ID = "recommended-heading";
const CREATORS_HEADING_ID = "creators-heading";

/**
 * My Page opens with what has arrived in what the reader follows, then what to
 * read next, and only then with what they have already read. The reader's plan
 * sits above all of them, because it is where a reader coming back from a
 * plan's checkout or its billing portal lands, and the coins they hold sit
 * beside it, as the other thing they have paid the site for in advance.
 *
 * Nothing here tells the reader who they are. Their display name is in the
 * account menu this page is reached from, and everything they can change about
 * the account is on `/settings`, which the header links to — a summary of both
 * would fill the top of the screen with what the reader came here already
 * knowing.
 *
 * Every section reads inside its own `<Suspense>`, so one slow or failing read
 * costs the page that section and nothing more.
 */
const MyPage = ({ searchParams }: MyPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="border border-border bg-card p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
              <Message message="storefront.my.title" />
            </Suspense>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="storefront.my.description" />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Suspense fallback={<SkeletonLine className="h-9 w-32" />}>
            <LocaleLink
              className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/my/library"
            >
              <Message message="storefront.my.to_library" />
            </LocaleLink>
          </Suspense>
          <Suspense fallback={<SkeletonLine className="h-9 w-28" />}>
            <LocaleLink
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              href="/settings"
            >
              <Message message="storefront.my.to_settings" />
            </LocaleLink>
          </Suspense>
        </div>
      </div>
    </section>

    <Suspense fallback={null}>
      <MyNotice searchParams={searchParams} />
    </Suspense>

    {/* No skeleton: most readers hold no plan, and on a site that sells none
      the section renders nothing, so a placeholder would only flash. */}
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="storefront.my.plan_error" />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <SubscriptionSection />
      </Suspense>
    </SectionErrorBoundary>

    {/* No skeleton, for the plan's reason: on a site that offers no coins
      the section renders nothing. */}
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="storefront.coins.balance_error" />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <CoinsSection />
      </Suspense>
    </SectionErrorBoundary>

    <section
      aria-labelledby={FOLLOW_UPDATES_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={FOLLOW_UPDATES_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
          <Message message="storefront.my.follow_updates_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my.follow_updates_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<FollowUpdatesSectionSkeleton />}>
          <FollowUpdatesSection searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section
      aria-labelledby={RECOMMENDED_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={RECOMMENDED_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="storefront.my.recommended_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my.recommended_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<RecommendedSeriesSkeleton />}>
          <RecommendedSeriesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section
      aria-labelledby={CREATORS_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={CREATORS_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="storefront.my.creators_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="storefront.my.creators_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<RecommendedCreatorsSkeleton />}>
          <RecommendedCreatorsSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="storefront.my.history_error" />
        </Suspense>
      }
    >
      <Suspense
        fallback={
          <section className="border border-border bg-card p-6">
            <SkeletonLine className="mb-4 h-6 w-32" />
            <Skeleton className="h-32 w-full" />
          </section>
        }
      >
        <ReadingHistorySection searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default MyPage;
