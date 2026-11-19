import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

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
    <ConsoleSection.Stack>
      {canEdit ? (
        <ConsoleSection.Root>
          <ConsoleSection.Header>
            <ConsoleSection.Heading>
              <ConsoleSection.Title>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.genres.create_card_title" />
                </Suspense>
              </ConsoleSection.Title>
              <ConsoleSection.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.genres.create_description" />
                </Suspense>
              </ConsoleSection.Description>
            </ConsoleSection.Heading>
          </ConsoleSection.Header>
          <GenreCreateForm
            namePlaceholder={t("admin.genres.form.name_placeholder")}
            tenantId={tenantId}
            tenantLocales={tenantLocales}
          />
        </ConsoleSection.Root>
      ) : null}

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.genres.list_title" />
              </Suspense>
            </ConsoleSection.Title>
            {canEdit ? (
              <ConsoleSection.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.genres.list_description" />
                </Suspense>
              </ConsoleSection.Description>
            ) : null}
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        <GenreListBody
          canEdit={canEdit}
          genres={genres}
          listErrorMessage={listErrorMessage}
          locale={locale}
          tenantId={tenantId}
        />
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};
