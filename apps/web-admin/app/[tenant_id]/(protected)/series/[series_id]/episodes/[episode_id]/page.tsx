import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SectionError } from "@publira/ui-components/section-error";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getEpisode, listEpisodeImages } from "#lib/episode";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeImagesSortableGrid } from "./_components/episode-images-sortable-grid";
import { EpisodePagesForm } from "./_components/episode-pages-form";
import { EpisodeScheduleForm } from "./_components/episode-schedule-form";
import {
  reorderEpisodeImagesAction,
  updateEpisodeScheduleAction,
  uploadEpisodePagesAction,
} from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.series.episodes.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

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
  const [episodeResult, imagesResult, timeZone, messages] = await Promise.all([
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
    getTenantDisplayTimeZone(tenantId),
    loadAdminMessages(locale),
  ]);
  if (!episodeResult.ok && episodeResult.notFound) {
    notFound();
  }

  await redirectToLoginIfSessionRejected(episodeResult, imagesResult);

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageEyebrow>{`Series ${series_id} / Episode ${episode_id}`}</AdminPageEyebrow>
          <AdminPageTitle>
            {getMessage(messages, "admin.series.episodes.edit_title")}
          </AdminPageTitle>
          <AdminPageDescription>
            {getMessage(messages, "admin.series.episodes.edit_description")}
          </AdminPageDescription>
        </AdminPageHeading>
        <AdminPageActions>
          <div className="flex gap-2">
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes`} />}
              variant="outline"
            >
              {getMessage(messages, "admin.series.episodes.back_to_list")}
            </LinkButton>
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes/new`} />}
              variant="outline"
            >
              {getMessage(messages, "admin.series.episodes.new_action")}
            </LinkButton>
          </div>
        </AdminPageActions>
      </AdminPageHeader>
      <AdminPageContent>
        <FlashToast
          keyName="created"
          title={getMessage(messages, "admin.series.episodes.created")}
        />
        <FlashToast
          keyName="schedule_updated"
          title={getMessage(messages, "admin.series.episodes.schedule_updated")}
        />
        <FlashToast
          keyName="pages_uploaded"
          title={getMessage(messages, "admin.series.episodes.pages_uploaded")}
        />
        <FlashToast
          keyName="images_reordered"
          title={getMessage(messages, "admin.series.episodes.image_reordered")}
        />
        <FlashToast
          keyName="image_reorder_error"
          title={getMessage(
            messages,
            "admin.series.episodes.image_reorder_error"
          )}
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
            <SectionError
              description={episodeResult.message}
              title={getMessage(
                messages,
                "admin.series.episodes.schedule_error"
              )}
            />
          )}
          <EpisodePagesForm
            action={uploadEpisodePagesAction}
            episodePublicId={episode_id}
            seriesPublicId={series_id}
          />

          <section className="grid gap-3 rounded-lg border border-border/70 p-4">
            <h2 className="text-sm font-medium">
              {getMessage(messages, "admin.series.episodes.image_list_title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {getMessage(
                messages,
                "admin.series.episodes.image_list_description"
              )}
            </p>

            {/*
              A failed read hands back an empty `images`, so the "nothing
              uploaded yet" state has to stay behind `imagesResult.ok`;
              otherwise the section says the images are missing and that they
              were never uploaded, in the same breath.
            */}
            {imagesResult.ok ? null : (
              <SectionError
                description={imagesResult.message}
                title={getMessage(
                  messages,
                  "admin.series.episodes.image_list_error"
                )}
              />
            )}

            {imagesResult.ok && imagesResult.images.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {getMessage(messages, "admin.series.episodes.image_list_empty")}
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
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default EditEpisodePage;
