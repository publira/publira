import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

interface EpisodeTitleFormProps {
  /** Shown between the heading and the form: the episode's language tabs. */
  children?: ReactNode;
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  episodePublicId: string;
  /**
   * The title the episode holds. Seeded once per mount: the page keys this
   * form by it, so a saved change remounts it.
   */
  initialTitle: string;
  seriesPublicId: string;
  tenantId: string;
  /**
   * The language the title is written in. Absent writes the tenant's default
   * language.
   */
  translationLocale?: Locale;
  /**
   * Whether the episode has a title in {@link translationLocale} yet. Without
   * one, the form opens empty and saving it adds the translation.
   */
  translated?: boolean;
}

const EpisodeTitleDescription = ({
  translated,
  translationLocale,
}: Pick<EpisodeTitleFormProps, "translated" | "translationLocale">) => {
  if (!translationLocale) {
    return <Message message="admin.series.episodes.rename.description" />;
  }
  const language = getLocaleLabel(translationLocale);
  return translated ? (
    <Message
      message="admin.series.episodes.translations.title_description"
      values={{ language }}
    />
  ) : (
    <Message
      message="admin.series.episodes.translations.not_added"
      values={{ language }}
    />
  );
};

export const EpisodeTitleForm = ({
  action,
  children,
  episodeId,
  episodePublicId,
  initialTitle,
  seriesPublicId,
  tenantId,
  translated = true,
  translationLocale,
}: EpisodeTitleFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.series.episodes.rename.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <EpisodeTitleDescription
              translated={translated}
              translationLocale={translationLocale}
            />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    {children}
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_public_id" type="hidden" value={seriesPublicId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="episode_public_id" type="hidden" value={episodePublicId} />
      {translationLocale ? (
        <input
          name="translation_locale"
          type="hidden"
          value={translationLocale}
        />
      ) : null}

      <ActionForm.Fieldset>
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.series.episodes.form.title" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialTitle}
              name="title"
              required
              type="text"
            />
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        {translated ? (
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.episodes.rename.update" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.episodes.updating" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        ) : (
          <ActionForm.Submit>
            <ActionForm.Idle>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.series.episodes.translations.add_action" />
              </Suspense>
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.series.episodes.translations.adding" />
              </Suspense>
            </ActionForm.Pending>
          </ActionForm.Submit>
        )}
      </div>
    </ActionForm.Root>
  </AdminSection>
);
