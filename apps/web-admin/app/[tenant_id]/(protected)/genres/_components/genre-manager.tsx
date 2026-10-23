import type { Locale } from "@publira/i18n";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
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
import type { TenantLocales } from "#lib/tenant-locales";

import type { GenreListItem } from "../genre-types";
import { GenreCreateForm } from "./genre-create-form";
import { GenreList } from "./genre-list";

interface GenreManagerProps {
  /** Whether the operator may write the genres, which a tenant auditor may not. */
  canEdit: boolean;
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  /** The languages the create form takes a name in; `null` when unread. */
  tenantLocales: TenantLocales | null;
}

const GenreListBody = async ({
  canEdit,
  genres,
  listErrorMessage,
  locale,
  tenantId,
}: {
  canEdit: boolean;
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
}) => {
  const t = await getMessagesFor(locale);
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no genres".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            {t("admin.genres.list_error")}
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (genres.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>{t("admin.genres.empty_title")}</EmptyState.Title>
          <EmptyState.Description>
            {t("admin.genres.empty_description")}
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  return <GenreList canEdit={canEdit} genres={genres} tenantId={tenantId} />;
};

export const GenreManager = async ({
  canEdit,
  genres,
  listErrorMessage,
  locale,
  tenantId,
  tenantLocales,
}: GenreManagerProps) => {
  const t = await getMessagesFor(locale);

  return (
    <AdminSections>
      {canEdit ? (
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
            tenantLocales={tenantLocales}
          />
        </AdminSection>
      ) : null}

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.list_title" />
              </Suspense>
            </AdminSectionTitle>
            {canEdit ? (
              <AdminSectionDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.genres.list_description" />
                </Suspense>
              </AdminSectionDescription>
            ) : null}
          </AdminSectionHeading>
        </AdminSectionHeader>
        <GenreListBody
          canEdit={canEdit}
          genres={genres}
          listErrorMessage={listErrorMessage}
          locale={locale}
          tenantId={tenantId}
        />
      </AdminSection>
    </AdminSections>
  );
};
