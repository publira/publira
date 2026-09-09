import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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

import { ActionForm, ActionFormSubmit } from "#components/action-form";
import { GENRE_NAME_MAX_LENGTH } from "#lib/genre-shared";

import { createGenreAction } from "../_lib/actions";
import type { GenreListItem } from "../genre-types";
import { GenreList } from "./genre-list";

interface GenreManagerProps {
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
}

const GenreListBody = ({
  genres,
  listErrorMessage,
  locale,
}: {
  genres: GenreListItem[];
  listErrorMessage?: string;
  locale: Locale;
}) => {
  const messages = sharedCatalog(locale);
  // A failed read still hands an empty array; the empty state next to the
  // error would read as "this tenant has no genres".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            {getMessage(messages, "admin.genres.list_error")}
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (genres.length === 0) {
    return (
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            {getMessage(messages, "admin.genres.empty_title")}
          </EmptyStateTitle>
          <EmptyStateDescription>
            {getMessage(messages, "admin.genres.empty_description")}
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    );
  }

  return <GenreList genres={genres} />;
};

export const GenreManager = ({
  genres,
  listErrorMessage,
  locale,
  tenantId,
}: GenreManagerProps) => {
  const messages = sharedCatalog(locale);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.genres.create_card_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.genres.create_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createGenreAction} className="grid gap-4">
            <input name="tenant_id" type="hidden" value={tenantId} />
            <Field>
              <FieldLabel required>
                {getMessage(messages, "admin.genres.form.name")}
              </FieldLabel>
              <FieldContent>
                <Input
                  className="sm:max-w-sm"
                  maxLength={GENRE_NAME_MAX_LENGTH}
                  name="name"
                  placeholder={getMessage(
                    messages,
                    "admin.genres.form.name_placeholder"
                  )}
                  required
                  type="text"
                />
              </FieldContent>
            </Field>
            <div className="flex justify-end">
              <ActionFormSubmit>
                {getMessage(messages, "admin.genres.create_action")}
              </ActionFormSubmit>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.genres.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.genres.list_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GenreListBody
            genres={genres}
            listErrorMessage={listErrorMessage}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
};
