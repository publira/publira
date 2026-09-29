import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { EpisodeEditActionState } from "../episode-edit-types";
import {
  EpisodePagesDropZone,
  EpisodePagesModeButton,
  EpisodePagesSelectedFiles,
  EpisodePagesUpload,
  EpisodePagesWhile,
} from "./episode-pages-upload-controls";

interface EpisodePagesFormProps {
  seriesId: string;
  seriesPublicId: string;
  episodeId: string;
  episodePublicId: string;
  action: (
    prevState: EpisodeEditActionState,
    formData: FormData
  ) => Promise<EpisodeEditActionState>;
  tenantId: string;
}

/** Awaits the catalog for the progress bar's name, which is an attribute rather than a node. */
export const EpisodePagesForm = async ({
  seriesId,
  seriesPublicId,
  episodeId,
  episodePublicId,
  action,
  tenantId,
}: EpisodePagesFormProps) => {
  const t = await getMessages();

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.series.episodes.pages.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.series.episodes.pages.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm action={action} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="series_id" type="hidden" value={seriesId} />
        <input name="series_public_id" type="hidden" value={seriesPublicId} />
        <input name="episode_id" type="hidden" value={episodeId} />
        <input name="episode_public_id" type="hidden" value={episodePublicId} />

        <EpisodePagesUpload>
          <ActionFormFieldset className="grid gap-4">
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.series.episodes.pages.target" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <p className="text-sm text-muted-foreground">
                  Series: {seriesPublicId} / Episode: {episodePublicId}
                </p>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.series.episodes.pages.method" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <div className="flex flex-wrap gap-2">
                  <EpisodePagesModeButton mode="pages">
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.series.episodes.pages.select_images" />
                    </Suspense>
                  </EpisodePagesModeButton>
                  <EpisodePagesModeButton mode="zip">
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.series.episodes.pages.select_zip" />
                    </Suspense>
                  </EpisodePagesModeButton>
                  <EpisodePagesModeButton mode="epub">
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.series.episodes.pages.select_epub" />
                    </Suspense>
                  </EpisodePagesModeButton>
                </div>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel required>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <EpisodePagesWhile mode="pages">
                    <Message message="admin.series.episodes.pages.image" />
                  </EpisodePagesWhile>
                  <EpisodePagesWhile mode="zip">
                    <Message message="admin.series.episodes.pages.zip" />
                  </EpisodePagesWhile>
                  <EpisodePagesWhile mode="epub">
                    <Message message="admin.series.episodes.pages.epub" />
                  </EpisodePagesWhile>
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <EpisodePagesDropZone>
                  <p className="mb-3 text-sm text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                      <EpisodePagesWhile mode="pages">
                        <Message message="admin.series.episodes.pages.drop_image" />
                      </EpisodePagesWhile>
                      <EpisodePagesWhile mode="zip">
                        <Message message="admin.series.episodes.pages.drop_zip" />
                      </EpisodePagesWhile>
                      <EpisodePagesWhile mode="epub">
                        <Message message="admin.series.episodes.pages.drop_epub" />
                      </EpisodePagesWhile>
                    </Suspense>
                  </p>
                </EpisodePagesDropZone>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <EpisodePagesWhile mode="pages">
                      <Message message="admin.series.episodes.pages.image_description" />
                    </EpisodePagesWhile>
                    <EpisodePagesWhile mode="zip">
                      <Message message="admin.series.episodes.pages.zip_description" />
                    </EpisodePagesWhile>
                    <EpisodePagesWhile mode="epub">
                      <Message message="admin.series.episodes.pages.epub_description" />
                    </EpisodePagesWhile>
                  </Suspense>
                </FieldDescription>
                <EpisodePagesSelectedFiles />
                <ActionFormPending>
                  <div className="grid gap-2">
                    <progress
                      aria-label={t(
                        "admin.series.episodes.pages.upload_progress"
                      )}
                      className="w-full"
                    />
                    <p className="text-xs text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-48" />}
                      >
                        <Message message="admin.series.episodes.pages.processing" />
                      </Suspense>
                    </p>
                  </div>
                </ActionFormPending>
              </FieldContent>
            </Field>
          </ActionFormFieldset>

          <div className="mt-2 flex justify-end gap-2">
            <ActionFormSubmit>
              <ActionFormIdle>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <EpisodePagesWhile mode="pages">
                    <Message message="admin.series.episodes.pages.submit_image" />
                  </EpisodePagesWhile>
                  <EpisodePagesWhile mode="zip">
                    <Message message="admin.series.episodes.pages.submit_zip" />
                  </EpisodePagesWhile>
                  <EpisodePagesWhile mode="epub">
                    <Message message="admin.series.episodes.pages.submit_epub" />
                  </EpisodePagesWhile>
                </Suspense>
              </ActionFormIdle>
              <ActionFormPending>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.series.episodes.pages.adding" />
                </Suspense>
              </ActionFormPending>
            </ActionFormSubmit>
          </div>
        </EpisodePagesUpload>
      </ActionForm>
    </AdminSection>
  );
};
