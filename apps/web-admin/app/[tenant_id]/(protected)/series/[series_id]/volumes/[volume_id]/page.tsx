import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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

import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { TenantEditorFieldset } from "#components/tenant-role-gate";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listAllEpisodes } from "#lib/episode";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantCurrency } from "#lib/public-api";
import { getSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getVolume } from "#lib/volume";

import { VolumeCoverForm } from "./_components/volume-cover-form";
import { VolumeDetailsForm } from "./_components/volume-details-form";
import { VolumeEpisodesForm } from "./_components/volume-episodes-form";
import { VolumeSaleForm } from "./_components/volume-sale-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.volumes.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "volume_id");

interface EditVolumePageProps {
  params: Promise<{
    series_id: string;
    tenant_id: string;
    volume_id: string;
  }>;
}

const editVolumeParamsSchema = z.object({
  series_id: routeParamString(),
  volume_id: routeParamString(),
});

const resolveParams = async (params: EditVolumePageProps["params"]) => {
  const parsedParams = parseRouteParams(editVolumeParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  return parsedParams;
};

const EditVolumeSkeleton = () => (
  <div className="grid gap-6">
    <Skeleton className="h-40" />
    <Skeleton className="h-64" />
    <Skeleton className="h-64" />
  </div>
);

const VolumeLoadError = ({
  message,
  seriesPublicId,
}: {
  message: string;
  seriesPublicId: string;
}) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Message message="admin.series.volumes.detail_error" />
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton
        render={<Link href={`/series/${seriesPublicId}/volumes`} />}
        variant="outline"
      >
        <Message message="admin.series.volumes.back_to_list" />
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
);

const EditVolumeBackLink = async ({ params }: EditVolumePageProps) => {
  const { series_id: seriesPublicId } = await resolveParams(params);

  return (
    <LinkButton
      render={<Link href={`/series/${seriesPublicId}/volumes`} />}
      variant="outline"
    >
      <Message message="admin.series.volumes.back_to_list" />
    </LinkButton>
  );
};

const EditVolumeData = async ({ params }: EditVolumePageProps) => {
  const [{ series_id: seriesPublicId, volume_id: volumePublicId }, tenantId] =
    await Promise.all([resolveParams(params), getTenantId()]);
  const [locale, seriesResult] = await Promise.all([
    getLocale(tenantId),
    getSeries({ publicId: seriesPublicId }),
  ]);
  if (!seriesResult.ok) {
    if (seriesResult.notFound) {
      notFound();
    }
    return (
      <VolumeLoadError
        message={seriesResult.message}
        seriesPublicId={seriesPublicId}
      />
    );
  }

  const seriesId = seriesResult.series.id;
  const [volumeResult, episodesResult, currency, t] = await Promise.all([
    getVolume({ publicId: volumePublicId, seriesId, tenantId }, locale),
    listAllEpisodes({ seriesId }),
    getTenantCurrency(tenantId),
    getMessagesFor(locale),
  ]);
  if (!volumeResult.ok) {
    if (volumeResult.notFound) {
      // Missing, or another series' volume — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }
    await redirectToLoginIfSessionRejected(volumeResult);
    return (
      <VolumeLoadError
        message={volumeResult.message}
        seriesPublicId={seriesPublicId}
      />
    );
  }

  const { volume } = volumeResult;
  const takenEpisodeIds = volumeResult.volumes.flatMap((other) =>
    other.id === volume.id ? [] : other.episodeIds
  );
  const episodes = episodesResult.episodes.map((episode, index) => ({
    id: episode.id,
    position: index + 1,
    title: episode.title,
  }));

  return (
    // Every section below holds what the editor typed or picked in local
    // state, so the screen is keyed by the volume it belongs to: moving to
    // another volume remounts it rather than leaving that state behind.
    <div className="grid gap-6" key={volume.publicId}>
      {currency ? (
        <VolumeDetailsForm
          currency={currency}
          // A form opened in the tenant's old currency starts over in the new
          // one instead of sending the amount typed in the old.
          key={currency}
          seriesId={seriesId}
          tenantId={tenantId}
          volume={volume}
        />
      ) : (
        <FormMessage variant="destructive">
          {t("admin.series.episodes.currency_unavailable")}
        </FormMessage>
      )}
      {episodesResult.ok ? (
        <VolumeEpisodesForm
          episodes={episodes}
          seriesId={seriesId}
          takenEpisodeIds={takenEpisodeIds}
          tenantId={tenantId}
          volume={volume}
        />
      ) : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Message message="admin.series.volumes.episodes.load_error" />
            </SectionError.Title>
            <SectionError.Description>
              {episodesResult.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}
      <VolumeCoverForm
        seriesId={seriesId}
        tenantId={tenantId}
        volume={volume}
      />
      <VolumeSaleForm seriesId={seriesId} tenantId={tenantId} volume={volume} />
    </div>
  );
};

const EditVolumePage = ({ params }: EditVolumePageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.series.volumes.edit_title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.edit_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <Suspense fallback={<SkeletonLine className="h-9 w-36" />}>
          <EditVolumeBackLink params={params} />
        </Suspense>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <FlashToast message="admin.series.volumes.created" />
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.series.volumes.detail_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<EditVolumeSkeleton />}>
          <TenantEditorFieldset>
            <EditVolumeData params={params} />
          </TenantEditorFieldset>
        </Suspense>
      </SectionErrorBoundary>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default EditVolumePage;
