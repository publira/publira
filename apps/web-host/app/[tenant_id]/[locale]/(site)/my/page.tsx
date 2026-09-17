import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";

import {
  FollowUpdatesSection,
  FollowUpdatesSectionSkeleton,
} from "./_components/follow-updates";
import { ReadingHistorySection } from "./_components/reading-history";
import {
  RecommendedCreatorsSection,
  RecommendedCreatorsSkeleton,
  RecommendedSeriesSection,
  RecommendedSeriesSkeleton,
} from "./_components/recommendations";

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
 * read next, and only then with what they have already read.
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
              <Message message="host.my.title" />
            </Suspense>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="host.my.description" />
            </Suspense>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Suspense fallback={<SkeletonLine className="h-9 w-32" />}>
            <LocaleLink
              className="inline-flex rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              href="/my/library"
            >
              <Message message="host.my.to_library" />
            </LocaleLink>
          </Suspense>
          <Suspense fallback={<SkeletonLine className="h-9 w-28" />}>
            <LocaleLink
              className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              href="/settings"
            >
              <Message message="host.my.to_settings" />
            </LocaleLink>
          </Suspense>
        </div>
      </div>
    </section>

    <section
      aria-labelledby={FOLLOW_UPDATES_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={FOLLOW_UPDATES_HEADING_ID}>
        <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
          <Message message="host.my.follow_updates_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.my.follow_updates_error" />
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
          <Message message="host.my.recommended_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.my.recommended_error" />
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
          <Message message="host.my.creators_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.my.creators_error" />
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
          <Message message="host.my.history_error" />
        </Suspense>
      }
    >
      <Suspense
        fallback={
          <section className="border border-border bg-card p-6">
            <SkeletonLine className="mb-4 h-6 w-32" />
            <div className="h-32 w-full animate-pulse rounded-md bg-muted" />
          </section>
        }
      >
        <ReadingHistorySection searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default MyPage;
