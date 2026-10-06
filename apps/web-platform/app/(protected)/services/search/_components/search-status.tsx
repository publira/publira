import type { Locale } from "@publira/i18n";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import {
  isSameSearchTarget,
  searchEngineName,
} from "#lib/search-settings-shared";
import type { PlatformSearchSettings } from "#lib/search-settings-shared";

import { SearchBuildRefresh } from "./search-build-refresh";

const labelClassName = "text-sm text-muted-foreground";
const valueClassName = "min-w-0 text-sm break-all";

interface SearchStatusProps {
  locale: Locale;
  settings: PlatformSearchSettings;
  timeZone: string;
}

/**
 * Which engine the storefront search answers from right now, and where a
 * build of the saved settings stands. The two differ for as long as the
 * worker is building the index a save named, and after a build that failed.
 */
export const SearchStatus = ({
  locale,
  settings,
  timeZone,
}: SearchStatusProps) => {
  const { serving } = settings;
  const savedEngine = searchEngineName(settings.engine);
  const servingEngine = searchEngineName(serving.engine);
  // A build for the target the search already answers from is a new index
  // for another text analysis, beside the one that keeps answering.
  const rebuild = isSameSearchTarget(settings);

  return (
    <PlatformSection>
      <PlatformSectionHeader>
        <PlatformSectionHeading>
          <PlatformSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="platform.search.status.title" />
            </Suspense>
          </PlatformSectionTitle>
          <PlatformSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="platform.search.status.description" />
            </Suspense>
          </PlatformSectionDescription>
        </PlatformSectionHeading>
      </PlatformSectionHeader>

      <dl className="grid gap-x-8 gap-y-4 sm:max-w-3xl sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.search.status.answering" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>{servingEngine}</dd>

        {serving.engine === "sql" ? null : (
          <>
            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.search.status.url" />
              </Suspense>
            </dt>
            <dd className={valueClassName}>{serving.url}</dd>

            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.search.status.index" />
              </Suspense>
            </dt>
            <dd className={valueClassName}>{serving.index}</dd>
          </>
        )}

        {serving.since ? (
          <>
            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.search.status.since" />
              </Suspense>
            </dt>
            <dd className={valueClassName}>
              {formatDateTime(serving.since, { locale, timeZone })}
            </dd>
          </>
        ) : null}
      </dl>

      {settings.buildState === "building" ? (
        <FormMessage className="sm:max-w-3xl" variant="info">
          {rebuild ? (
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="platform.search.status.rebuilding"
                values={{ engine: savedEngine }}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="platform.search.status.building"
                values={{ engine: savedEngine, serving: servingEngine }}
              />
            </Suspense>
          )}
        </FormMessage>
      ) : null}

      {settings.buildState === "failed" ? (
        <FormMessage className="sm:max-w-3xl" variant="destructive">
          <span className="grid gap-1">
            <span>
              {rebuild ? (
                <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                  <Message
                    message="platform.search.status.rebuild_failed"
                    values={{ engine: savedEngine }}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                  <Message
                    message="platform.search.status.failed"
                    values={{ engine: savedEngine, serving: servingEngine }}
                  />
                </Suspense>
              )}
            </span>
            {settings.buildFailure?.failedAt ? (
              <span>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message
                    message="platform.search.status.failed_at"
                    values={{
                      time: formatDateTime(settings.buildFailure.failedAt, {
                        locale,
                        timeZone,
                      }),
                    }}
                  />
                </Suspense>
              </span>
            ) : null}
            {settings.buildFailure?.error ? (
              <code className="break-all whitespace-pre-wrap">
                {settings.buildFailure.error}
              </code>
            ) : null}
          </span>
        </FormMessage>
      ) : null}

      {/* A failed build is retried on the worker's every pass, so a page left
          open on the failure still notices an engine that was repaired. */}
      {settings.buildState === "serving" ? null : <SearchBuildRefresh />}
    </PlatformSection>
  );
};
