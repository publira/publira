import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import * as EpisodePages from "./episode-pages-upload-controls";

interface EpisodePagesFormProps {
  seriesId: string;
  seriesPublicId: string;
  episodeId: string;
  episodePublicId: string;
}

/** Awaits the catalog for the progress bar's name, which is an attribute rather than a node. */
export const EpisodePagesForm = async ({
  seriesId,
  seriesPublicId,
  episodeId,
  episodePublicId,
}: EpisodePagesFormProps) => {
  const t = await getMessages();

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.series.episodes.pages.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.series.episodes.pages.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <EpisodePages.UploadForm>
        <input name="series_id" type="hidden" value={seriesId} />
        <input name="episode_id" type="hidden" value={episodeId} />

        <EpisodePages.Root>
          <ActionForm.Fieldset className="grid gap-4">
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.series.episodes.pages.target" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <p className="text-sm text-muted-foreground">
                  Series: {seriesPublicId} / Episode: {episodePublicId}
                </p>
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.series.episodes.pages.method" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <div className="flex flex-wrap gap-2">
                  <EpisodePages.ModeButton mode="pages">
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.series.episodes.pages.select_images" />
                    </Suspense>
                  </EpisodePages.ModeButton>
                  <EpisodePages.ModeButton mode="zip">
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.series.episodes.pages.select_zip" />
                    </Suspense>
                  </EpisodePages.ModeButton>
                  <EpisodePages.ModeButton mode="epub">
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message message="admin.series.episodes.pages.select_epub" />
                    </Suspense>
                  </EpisodePages.ModeButton>
                </div>
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <EpisodePages.While mode="pages">
                    <Message message="admin.series.episodes.pages.image" />
                  </EpisodePages.While>
                  <EpisodePages.While mode="zip">
                    <Message message="admin.series.episodes.pages.zip" />
                  </EpisodePages.While>
                  <EpisodePages.While mode="epub">
                    <Message message="admin.series.episodes.pages.epub" />
                  </EpisodePages.While>
                </Suspense>
              </Field.Label>
              <Field.Content>
                <EpisodePages.DropZone>
                  <p className="mb-3 text-sm text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                      <EpisodePages.While mode="pages">
                        <Message message="admin.series.episodes.pages.drop_image" />
                      </EpisodePages.While>
                      <EpisodePages.While mode="zip">
                        <Message message="admin.series.episodes.pages.drop_zip" />
                      </EpisodePages.While>
                      <EpisodePages.While mode="epub">
                        <Message message="admin.series.episodes.pages.drop_epub" />
                      </EpisodePages.While>
                    </Suspense>
                  </p>
                </EpisodePages.DropZone>
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <EpisodePages.While mode="pages">
                      <Message message="admin.series.episodes.pages.image_description" />
                    </EpisodePages.While>
                    <EpisodePages.While mode="zip">
                      <Message message="admin.series.episodes.pages.zip_description" />
                    </EpisodePages.While>
                    <EpisodePages.While mode="epub">
                      <Message message="admin.series.episodes.pages.epub_description" />
                    </EpisodePages.While>
                  </Suspense>
                </Field.Description>
                <EpisodePages.SelectedFiles />
                <ActionForm.Pending>
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
                </ActionForm.Pending>
              </Field.Content>
            </Field.Root>
          </ActionForm.Fieldset>

          <div className="mt-2 flex justify-end gap-2">
            <ActionForm.Submit>
              <ActionForm.Idle>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <EpisodePages.While mode="pages">
                    <Message message="admin.series.episodes.pages.submit_image" />
                  </EpisodePages.While>
                  <EpisodePages.While mode="zip">
                    <Message message="admin.series.episodes.pages.submit_zip" />
                  </EpisodePages.While>
                  <EpisodePages.While mode="epub">
                    <Message message="admin.series.episodes.pages.submit_epub" />
                  </EpisodePages.While>
                </Suspense>
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.series.episodes.pages.adding" />
                </Suspense>
              </ActionForm.Pending>
            </ActionForm.Submit>
          </div>
        </EpisodePages.Root>
      </EpisodePages.UploadForm>
    </ConsoleSection.Root>
  );
};
