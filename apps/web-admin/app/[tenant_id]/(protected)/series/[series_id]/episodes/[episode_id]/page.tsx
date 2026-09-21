import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageContext,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { listCreatorRoles } from "#lib/creator-roles";
import {
  getEpisode,
  listEpisodeCredits,
  listEpisodeImages,
} from "#lib/episode";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeAvailabilityForm } from "./_components/episode-availability-form";
import { EpisodeCreatorCreditsForm } from "./_components/episode-creator-credits-form";
import { EpisodeImagesSortableGrid } from "./_components/episode-images-sortable-grid";
import { EpisodePagesForm } from "./_components/episode-pages-form";
import { EpisodeReadingLayoutForm } from "./_components/episode-reading-layout-form";
import { EpisodeScheduleForm } from "./_components/episode-schedule-form";
import {
  reorderEpisodeImagesAction,
  updateEpisodeAvailabilityAction,
  updateEpisodeLayoutAction,
  replaceEpisodeCreditsAction,
  updateEpisodeScheduleAction,
  uploadEpisodePagesAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.episodes.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

// This authenticated editor reads the session before its data can load.
export const instant = false;

const editEpisodeParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

const EditEpisodePage = async ({
  params,
}: PageProps<"/[tenant_id]/series/[series_id]/episodes/[episode_id]">) => {
  const [rawParams, tenantId] = await Promise.all([params, getTenantId()]);
  const parsedParams = parseRouteParams(editEpisodeParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { episode_id, series_id } = parsedParams;

  const locale = await getLocale(tenantId);
  const [
    episodeResult,
    imagesResult,
    seriesResult,
    creditsResult,
    creatorsResult,
    creatorRolesResult,
    timeZone,
    t,
  ] = await Promise.all([
    getEpisode(
      {
        publicId: episode_id,
        seriesPublicId: series_id,
        tenantId,
      },
      locale
    ),
    listEpisodeImages(
      {
        episodePublicId: episode_id,
        tenantId,
      },
      locale
    ),
    // Only to name what the layout and availability options that follow the
    // series follow, so a read that failed leaves them unnamed rather than the
    // forms unusable.
    getSeries({ publicId: series_id, tenantId }, locale),
    listEpisodeCredits({ episodePublicId: episode_id, tenantId }, locale),
    listAllCreators(tenantId, locale),
    listCreatorRoles(tenantId, locale),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);
  if (!episodeResult.ok && episodeResult.notFound) {
    notFound();
  }

  await redirectToLoginIfSessionRejected(
    episodeResult,
    imagesResult,
    seriesResult,
    creditsResult,
    creatorsResult,
    creatorRolesResult
  );

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageContext>{`Series ${series_id}, episode ${episode_id}`}</AdminPageContext>
          <AdminPageTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.edit_title" />
            </Suspense>
          </AdminPageTitle>
          <AdminPageDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.episodes.edit_description" />
            </Suspense>
          </AdminPageDescription>
        </AdminPageHeading>
        <AdminPageActions>
          <div className="flex gap-2">
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes`} />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.back_to_list" />
              </Suspense>
            </LinkButton>
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes/new`} />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.series.episodes.new_action" />
              </Suspense>
            </LinkButton>
          </div>
        </AdminPageActions>
      </AdminPageHeader>
      <AdminPageContent>
        <FlashToast
          keyName="created"
          title={t("admin.series.episodes.created")}
        />
        <FlashToast
          keyName="schedule_updated"
          title={t("admin.series.episodes.schedule_updated")}
        />
        <FlashToast
          keyName="availability_updated"
          title={t("admin.series.episodes.availability.updated")}
        />
        <FlashToast
          keyName="layout_updated"
          title={t("admin.series.episodes.layout.updated")}
        />
        <FlashToast
          keyName="credits_updated"
          title={t("admin.series.episodes.credits_updated")}
        />
        <FlashToast
          keyName="pages_uploaded"
          title={t("admin.series.episodes.pages_uploaded")}
        />
        <FlashToast
          keyName="images_reordered"
          title={t("admin.series.episodes.image_reordered")}
        />
        <FlashToast
          keyName="image_reorder_error"
          title={t("admin.series.episodes.image_reorder_error")}
        />

        <div className="grid gap-6">
          {episodeResult.ok ? (
            <EpisodeScheduleForm
              action={updateEpisodeScheduleAction}
              episodePublicId={episode_id}
              scheduledAt={episodeResult.episode.scheduledAt}
              seriesPublicId={series_id}
              timeZone={timeZone}
            />
          ) : (
            <SectionError>
              <SectionErrorHeading>
                <SectionErrorTitle>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="admin.series.episodes.schedule_error" />
                  </Suspense>
                </SectionErrorTitle>
                <SectionErrorDescription>
                  {episodeResult.message}
                </SectionErrorDescription>
              </SectionErrorHeading>
            </SectionError>
          )}
          {episodeResult.ok ? (
            <EpisodeAvailabilityForm
              action={updateEpisodeAvailabilityAction}
              episodePublicId={episode_id}
              initialAvailability={episodeResult.episode.availability}
              key={`${episode_id}:${episodeResult.episode.availability}`}
              seriesAvailability={
                seriesResult.ok ? seriesResult.series.availability : undefined
              }
              seriesPublicId={series_id}
              tenantId={tenantId}
            />
          ) : (
            <SectionError>
              <SectionErrorHeading>
                <SectionErrorTitle>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="admin.series.episodes.availability.error" />
                  </Suspense>
                </SectionErrorTitle>
                <SectionErrorDescription>
                  {episodeResult.message}
                </SectionErrorDescription>
              </SectionErrorHeading>
            </SectionError>
          )}
          {creditsResult.ok ? (
            <EpisodeCreatorCreditsForm
              action={replaceEpisodeCreditsAction}
              creatorRoles={creatorRolesResult.creatorRoles}
              creators={creatorsResult.creators}
              episodePublicId={episode_id}
              initialCredits={creditsResult.credits}
              seriesPublicId={series_id}
            />
          ) : (
            <SectionError>
              <SectionErrorHeading>
                <SectionErrorTitle>
                  <Message message="admin.series.episodes.credits_error" />
                </SectionErrorTitle>
                <SectionErrorDescription>
                  {creditsResult.message}
                </SectionErrorDescription>
              </SectionErrorHeading>
            </SectionError>
          )}
          <EpisodePagesForm
            action={uploadEpisodePagesAction}
            episodePublicId={episode_id}
            seriesPublicId={series_id}
          />

          <section className="grid gap-3 border border-border p-4">
            <h2 className="text-sm font-medium">
              <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                <Message message="admin.series.episodes.image_list_title" />
              </Suspense>
            </h2>
            <p className="text-xs text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message message="admin.series.episodes.image_list_description" />
              </Suspense>
            </p>

            {/*
              A failed read hands back an empty `images`, so the "nothing
              uploaded yet" state has to stay behind `imagesResult.ok`;
              otherwise the section says the images are missing and that they
              were never uploaded, in the same breath.
            */}
            {imagesResult.ok ? null : (
              <SectionError>
                <SectionErrorHeading>
                  <SectionErrorTitle>
                    <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                      <Message message="admin.series.episodes.image_list_error" />
                    </Suspense>
                  </SectionErrorTitle>
                  <SectionErrorDescription>
                    {imagesResult.message}
                  </SectionErrorDescription>
                </SectionErrorHeading>
              </SectionError>
            )}

            {imagesResult.ok && imagesResult.images.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="admin.series.episodes.image_list_empty" />
                </Suspense>
              </p>
            ) : null}

            {imagesResult.images.length > 0 ? (
              <EpisodeImagesSortableGrid
                episodePublicId={episode_id}
                images={imagesResult.images}
                reorderAction={reorderEpisodeImagesAction}
                seriesPublicId={series_id}
              />
            ) : null}
          </section>

          {episodeResult.ok ? (
            <EpisodeReadingLayoutForm
              action={updateEpisodeLayoutAction}
              episodePublicId={episode_id}
              initialLayout={episodeResult.layout}
              key={`${episode_id}:${episodeResult.layout.readingDirection}:${episodeResult.layout.spreadStartIndex ?? ""}`}
              pageCount={
                imagesResult.ok ? imagesResult.images.length : undefined
              }
              seriesLayout={
                seriesResult.ok ? seriesResult.readingLayout : undefined
              }
              seriesPublicId={series_id}
              tenantId={tenantId}
            />
          ) : (
            <SectionError>
              <SectionErrorHeading>
                <SectionErrorTitle>
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="admin.series.episodes.layout.error" />
                  </Suspense>
                </SectionErrorTitle>
                <SectionErrorDescription>
                  {episodeResult.message}
                </SectionErrorDescription>
              </SectionErrorHeading>
            </SectionError>
          )}
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default EditEpisodePage;
