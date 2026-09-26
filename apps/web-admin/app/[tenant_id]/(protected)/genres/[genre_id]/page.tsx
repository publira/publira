import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
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
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { EyeCatchAspectImages } from "#components/eye-catch/aspect-images";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { parseEditTab } from "#lib/edit-tab-search-params";
import { getGenre } from "#lib/genre";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { GenreEyeCatchForm } from "../_components/genre-eye-catch-form";
import { GenreRenameForm } from "../_components/genre-rename-form";
import { GenreTabNav } from "../_components/genre-tab-nav";
import { uploadGenreEyeCatchAspectImageAction } from "../_lib/actions";

interface EditGenrePageProps {
  params: Promise<{
    genre_id: string;
    tenant_id: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
}

const editGenreParamsSchema = z.object({
  genre_id: routeParamString(),
});

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.genres.edit_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "genre_id");

const EditGenreFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const resolveActiveTab = async (
  searchParams: EditGenrePageProps["searchParams"]
): Promise<"basic" | "eye-catch"> => parseEditTab(await searchParams);

const EditGenreTitle = async ({
  searchParams,
}: Pick<EditGenrePageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.genres.eye_catch_title" />
  ) : (
    <Message message="admin.genres.edit_title" />
  );
};

const EditGenreDescription = async ({
  searchParams,
}: Pick<EditGenrePageProps, "searchParams">) => {
  const activeTab = await resolveActiveTab(searchParams);
  return activeTab === "eye-catch" ? (
    <Message message="admin.genres.eye_catch_description" />
  ) : (
    <Message message="admin.genres.edit_description" />
  );
};

const EditGenreTabNav = async ({
  params,
  searchParams,
}: EditGenrePageProps) => {
  const [rawParams, activeTab] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
  ]);
  const parsedParams = parseRouteParams(editGenreParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }

  return <GenreTabNav current={activeTab} genreId={parsedParams.genre_id} />;
};

const EditGenreFormData = async ({
  params,
  searchParams,
}: EditGenrePageProps) => {
  const [rawParams, activeTab, tenantId] = await Promise.all([
    params,
    resolveActiveTab(searchParams),
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(editGenreParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }

  const locale = await getLocale(tenantId);
  const result = await getGenre(
    { publicId: parsedParams.genre_id, tenantId },
    locale
  );

  if (!result.ok) {
    if (result.notFound) {
      // Missing, or another tenant's genre — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Message message="admin.genres.detail_error" />
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <LinkButton render={<Link href="/genres" />} variant="outline">
            <Message message="admin.genres.back_to_list" />
          </LinkButton>
        </SectionErrorActions>
      </SectionError>
    );
  }

  if (activeTab === "eye-catch") {
    return (
      // Both cards hold the picked file and the chosen ratio in local state,
      // so the tab is keyed by the genre it belongs to: moving to another
      // genre remounts it rather than leaving that state behind.
      <div className="grid gap-6" key={result.genre.publicId}>
        <GenreEyeCatchForm genre={result.genre} tenantId={tenantId} />
        <EyeCatchAspectImages
          publicId={result.genre.publicId}
          uploadAction={uploadGenreEyeCatchAspectImageAction}
          variants={result.genre.eyeCatchImageVariants}
        />
      </div>
    );
  }

  return <GenreRenameForm genre={result.genre} key={result.genre.publicId} />;
};

const EditGenrePage = ({ params, searchParams }: EditGenrePageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
            <EditGenreTitle searchParams={searchParams} />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <EditGenreDescription searchParams={searchParams} />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/genres" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.genres.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
          <EditGenreTabNav params={params} searchParams={searchParams} />
        </Suspense>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.genres.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<EditGenreFormSkeleton />}>
            <EditGenreFormData params={params} searchParams={searchParams} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default EditGenrePage;
