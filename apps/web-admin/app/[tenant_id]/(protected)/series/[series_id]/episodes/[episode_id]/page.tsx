import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
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
import { resolvePurchaseAvailability } from "#lib/purchase-availability";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantPurchaseSettings } from "#lib/tenant-purchase-settings";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeAvailabilityForm } from "./_components/episode-availability-form";
import { EpisodeCreatorCreditsForm } from "./_components/episode-creator-credits-form";
import { EpisodeImagesSortableGrid } from "./_components/episode-images-sortable-grid";
import { EpisodePagesForm } from "./_components/episode-pages-form";
import { EpisodePurchaseAvailabilityForm } from "./_components/episode-purchase-availability-form";
import { EpisodeReadingLayoutForm } from "./_components/episode-reading-layout-form";
import { EpisodeScheduleForm } from "./_components/episode-schedule-form";
import {
  reorderEpisodeImagesAction,
  updateEpisodeAvailabilityAction,
  updateEpisodeLayoutAction,
  updateEpisodePurchaseAvailabilityAction,
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

type EditEpisodePageProps =
  PageProps<"/[tenant_id]/series/[series_id]/episodes/[episode_id]">;

type EditEpisodeSectionProps = Pick<EditEpisodePageProps, "params">;

const editEpisodeParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

interface EditEpisodeContext {
  episodeId: string;
  locale: Locale;
  seriesId: string;
  tenantId: string;
}

const resolveEditEpisodeContext = async (
  params: EditEpisodePageProps["params"]
): Promise<EditEpisodeContext> => {
  const [rawParams, tenantId] = await Promise.all([params, getTenantId()]);
  const parsedParams = parseRouteParams(editEpisodeParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const locale = await getLocale(tenantId);

  return {
    episodeId: parsedParams.episode_id,
    locale,
    seriesId: parsedParams.series_id,
    tenantId,
  };
};

const loadEpisode = async ({
  episodeId,
  locale,
  seriesId,
  tenantId,
}: EditEpisodeContext) => {
  const result = await getEpisode(
    { publicId: episodeId, seriesPublicId: seriesId, tenantId },
    locale
  );
  if (!result.ok && result.notFound) {
    notFound();
  }
  return result;
};

const EpisodeSectionError = ({
  message,
  title,
}: {
  message: string;
  title: ReactNode;
}) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          {title}
        </Suspense>
      </SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
  </SectionError>
);

const EditEpisodeContextLine = async ({ params }: EditEpisodeSectionProps) => {
  const { episodeId, seriesId } = await resolveEditEpisodeContext(params);

  return `Series ${seriesId}, episode ${episodeId}`;
};

const EditEpisodeActions = async ({ params }: EditEpisodeSectionProps) => {
  const { seriesId } = await resolveEditEpisodeContext(params);

  return (
    <div className="flex gap-2">
      <LinkButton
        render={<Link href={`/series/${seriesId}/episodes`} />}
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.series.episodes.back_to_list" />
        </Suspense>
      </LinkButton>
      <LinkButton
        render={<Link href={`/series/${seriesId}/episodes/new`} />}
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.series.episodes.new_action" />
        </Suspense>
      </LinkButton>
    </div>
  );
};

const EpisodeScheduleSection = async ({ params }: EditEpisodeSectionProps) => {
  const context = await resolveEditEpisodeContext(params);
  const [episodeResult, timeZone] = await Promise.all([
    loadEpisode(context),
    getTenantDisplayTimeZone(context.tenantId),
  ]);
  await redirectToLoginIfSessionRejected(episodeResult);

  if (!episodeResult.ok) {
    return (
      <EpisodeSectionError
        message={episodeResult.message}
        title={<Message message="admin.series.episodes.schedule_error" />}
      />
    );
  }

  return (
    <EpisodeScheduleForm
      action={updateEpisodeScheduleAction}
      episodePublicId={context.episodeId}
      scheduledAt={episodeResult.episode.scheduledAt}
      seriesPublicId={context.seriesId}
      timeZone={timeZone}
    />
  );
};

const EpisodeAvailabilitySection = async ({
  params,
}: EditEpisodeSectionProps) => {
  const context = await resolveEditEpisodeContext(params);
  const [episodeResult, seriesResult] = await Promise.all([
    loadEpisode(context),
    // Only to name what the option that follows the series follows, so a read
    // that failed leaves it unnamed rather than the form unusable.
    getSeries(
      { publicId: context.seriesId, tenantId: context.tenantId },
      context.locale
    ),
  ]);
  await redirectToLoginIfSessionRejected(episodeResult, seriesResult);

  if (!episodeResult.ok) {
    return (
      <EpisodeSectionError
        message={episodeResult.message}
        title={<Message message="admin.series.episodes.availability.error" />}
      />
    );
  }

  return (
    <EpisodeAvailabilityForm
      action={updateEpisodeAvailabilityAction}
      episodePublicId={context.episodeId}
      initialAvailability={episodeResult.episode.availability}
      key={`${context.episodeId}:${episodeResult.episode.availability}`}
      seriesAvailability={
        seriesResult.ok ? seriesResult.series.availability : undefined
      }
      seriesPublicId={context.seriesId}
      tenantId={context.tenantId}
    />
  );
};

const EpisodePurchaseAvailabilitySection = async ({
  params,
}: EditEpisodeSectionProps) => {
  const context = await resolveEditEpisodeContext(params);
  const [episodeResult, seriesResult, purchaseSettingsResult] =
    await Promise.all([
      loadEpisode(context),
      // Likewise only to name the place of sale the series follows; a series
      // that sets none follows the tenant's default.
      getSeries(
        { publicId: context.seriesId, tenantId: context.tenantId },
        context.locale
      ),
      getTenantPurchaseSettings(context.tenantId, context.locale),
    ]);
  await redirectToLoginIfSessionRejected(
    episodeResult,
    seriesResult,
    purchaseSettingsResult
  );

  if (!episodeResult.ok) {
    return (
      <EpisodeSectionError
        message={episodeResult.message}
        title={
          <Message message="admin.series.episodes.purchase_availability.error" />
        }
      />
    );
  }

  return (
    <EpisodePurchaseAvailabilityForm
      action={updateEpisodePurchaseAvailabilityAction}
      episodePublicId={context.episodeId}
      initialPurchaseAvailability={episodeResult.purchaseAvailability}
      key={`${context.episodeId}:purchase:${episodeResult.purchaseAvailability}`}
      seriesPublicId={context.seriesId}
      seriesPurchaseAvailability={
        seriesResult.ok && purchaseSettingsResult.ok
          ? resolvePurchaseAvailability(
              purchaseSettingsResult.settings.purchaseAvailability,
              seriesResult.purchaseAvailability
            )
          : undefined
      }
      tenantId={context.tenantId}
    />
  );
};

const EpisodeCreditsSection = async ({ params }: EditEpisodeSectionProps) => {
  const { episodeId, locale, seriesId, tenantId } =
    await resolveEditEpisodeContext(params);
  const [creditsResult, creatorsResult, creatorRolesResult] = await Promise.all(
    [
      listEpisodeCredits({ episodePublicId: episodeId, tenantId }, locale),
      listAllCreators(tenantId, locale),
      listCreatorRoles(tenantId, locale),
    ]
  );
  await redirectToLoginIfSessionRejected(
    creditsResult,
    creatorsResult,
    creatorRolesResult
  );

  if (!creditsResult.ok) {
    return (
      <EpisodeSectionError
        message={creditsResult.message}
        title={<Message message="admin.series.episodes.credits_error" />}
      />
    );
  }

  return (
    <EpisodeCreatorCreditsForm
      action={replaceEpisodeCreditsAction}
      creatorRoles={creatorRolesResult.creatorRoles}
      creators={creatorsResult.creators}
      episodePublicId={episodeId}
      initialCredits={creditsResult.credits}
      seriesPublicId={seriesId}
    />
  );
};

const EpisodePagesSection = async ({ params }: EditEpisodeSectionProps) => {
  const { episodeId, seriesId } = await resolveEditEpisodeContext(params);

  return (
    <EpisodePagesForm
      action={uploadEpisodePagesAction}
      episodePublicId={episodeId}
      seriesPublicId={seriesId}
    />
  );
};

const EpisodeImageList = async ({ params }: EditEpisodeSectionProps) => {
  const { episodeId, locale, seriesId, tenantId } =
    await resolveEditEpisodeContext(params);
  const imagesResult = await listEpisodeImages(
    { episodePublicId: episodeId, tenantId },
    locale
  );
  await redirectToLoginIfSessionRejected(imagesResult);

  // A failed read hands back an empty `images`, so the "nothing uploaded yet"
  // state has to stay behind `imagesResult.ok`; otherwise the section says the
  // images are missing and that they were never uploaded, in the same breath.
  if (!imagesResult.ok) {
    return (
      <EpisodeSectionError
        message={imagesResult.message}
        title={<Message message="admin.series.episodes.image_list_error" />}
      />
    );
  }

  if (imagesResult.images.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message message="admin.series.episodes.image_list_empty" />
        </Suspense>
      </p>
    );
  }

  return (
    <EpisodeImagesSortableGrid
      episodePublicId={episodeId}
      images={imagesResult.images}
      reorderAction={reorderEpisodeImagesAction}
      seriesPublicId={seriesId}
    />
  );
};

const EpisodeReadingLayoutSection = async ({
  params,
}: EditEpisodeSectionProps) => {
  const context = await resolveEditEpisodeContext(params);
  const [episodeResult, imagesResult, seriesResult] = await Promise.all([
    loadEpisode(context),
    listEpisodeImages(
      { episodePublicId: context.episodeId, tenantId: context.tenantId },
      context.locale
    ),
    getSeries(
      { publicId: context.seriesId, tenantId: context.tenantId },
      context.locale
    ),
  ]);
  await redirectToLoginIfSessionRejected(
    episodeResult,
    imagesResult,
    seriesResult
  );

  if (!episodeResult.ok) {
    return (
      <EpisodeSectionError
        message={episodeResult.message}
        title={<Message message="admin.series.episodes.layout.error" />}
      />
    );
  }

  return (
    <EpisodeReadingLayoutForm
      action={updateEpisodeLayoutAction}
      episodePublicId={context.episodeId}
      initialLayout={episodeResult.layout}
      key={`${context.episodeId}:${episodeResult.layout.readingDirection}:${episodeResult.layout.spreadStartIndex ?? ""}`}
      pageCount={imagesResult.ok ? imagesResult.images.length : undefined}
      seriesLayout={seriesResult.ok ? seriesResult.readingLayout : undefined}
      seriesPublicId={context.seriesId}
      tenantId={context.tenantId}
    />
  );
};

const EditEpisodePage = ({ params }: EditEpisodePageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageContext>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <EditEpisodeContextLine params={params} />
          </Suspense>
        </AdminPageContext>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.series.episodes.edit_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.series.episodes.edit_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <Suspense
          fallback={
            <div className="flex gap-2">
              <SkeletonLine className="h-10 w-28" />
              <SkeletonLine className="h-10 w-28" />
            </div>
          }
        >
          <EditEpisodeActions params={params} />
        </Suspense>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast message="admin.series.episodes.created" />
      <FlashToast
        keyName="schedule_updated"
        message="admin.series.episodes.schedule_updated"
      />
      <FlashToast
        keyName="availability_updated"
        message="admin.series.episodes.availability.updated"
      />
      <FlashToast
        keyName="purchase_availability_updated"
        message="admin.series.episodes.purchase_availability.updated"
      />
      <FlashToast
        keyName="layout_updated"
        message="admin.series.episodes.layout.updated"
      />
      <FlashToast
        keyName="credits_updated"
        message="admin.series.episodes.credits_updated"
      />
      <FlashToast
        keyName="pages_uploaded"
        message="admin.series.episodes.pages_uploaded"
      />
      <FlashToast
        keyName="images_reordered"
        message="admin.series.episodes.image_reordered"
      />
      <FlashToast
        keyName="image_reorder_error"
        message="admin.series.episodes.image_reorder_error"
      />

      <div className="grid gap-6">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <EpisodeScheduleSection params={params} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <EpisodeAvailabilitySection params={params} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <EpisodePurchaseAvailabilitySection params={params} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <EpisodeCreditsSection params={params} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <EpisodePagesSection params={params} />
        </Suspense>

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
          <Suspense fallback={<Skeleton className="h-32" />}>
            <EpisodeImageList params={params} />
          </Suspense>
        </section>

        <Suspense fallback={<Skeleton className="h-40" />}>
          <EpisodeReadingLayoutSection params={params} />
        </Suspense>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditEpisodePage;
