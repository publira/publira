import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type { GenreListItem } from "../genre-types";
import { GenreCreateForm } from "./genre-create-form";
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
        <GenreCreateForm
          namePlaceholder={t("admin.genres.form.name_placeholder")}
          tenantId={tenantId}
        />
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
