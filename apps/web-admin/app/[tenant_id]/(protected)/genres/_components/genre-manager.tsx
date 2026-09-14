import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { CATALOG_NAME_MAX_LENGTH } from "#lib/catalog-name";
import { getMessagesFor } from "#lib/messages";

import { createGenreAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";
import { GenreList } from "./genre-list";

interface GenreManagerProps {
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
}

const GenreListBody = async ({
  genres,
  listErrorMessage,
  locale,
}: {
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
}) => {
  const t = await getMessagesFor(locale);
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no genres".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>{t("admin.genres.list_error")}</SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (genres.length === 0) {
    return (
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>{t("admin.genres.empty_title")}</EmptyStateTitle>
          <EmptyStateDescription>
            {t("admin.genres.empty_description")}
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    );
  }

  return <GenreList genres={genres} />;
};

export const GenreManager = async ({
  genres,
  listErrorMessage,
  locale,
  tenantId,
}: GenreManagerProps) => {
  const t = await getMessagesFor(locale);

  return (
    <AdminSections>
      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.create_card_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.create_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        <ActionForm action={createGenreAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <Field>
            <FieldLabel required>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.form.name" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                className="sm:max-w-sm"
                maxLength={CATALOG_NAME_MAX_LENGTH}
                name="name"
                placeholder={t("admin.genres.form.name_placeholder")}
                required
                type="text"
              />
            </FieldContent>
          </Field>
          <div className="flex justify-end">
            <ActionFormSubmit>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.create_action" />
              </Suspense>
            </ActionFormSubmit>
          </div>
        </ActionForm>
      </AdminSection>

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.list_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.list_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        <GenreListBody
          genres={genres}
          listErrorMessage={listErrorMessage}
          locale={locale}
        />
      </AdminSection>
    </AdminSections>
  );
};
