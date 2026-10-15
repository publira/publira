import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
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
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { ReaderIcon } from "#components/reader-icon";
import { getMessages } from "#lib/get-messages";
import type { ReaderIconPresetItem } from "#lib/reader-icon-settings";
import { READER_ICON_PRESET_LIMIT } from "#lib/reader-icon-settings-shared";

import { uploadReaderIconPresetAction } from "../_lib/actions";
import { ReaderIconPresetDeleteButton } from "./reader-icon-preset-delete-button";

interface ReaderIconPresetGalleryProps {
  canEdit: boolean;
  /** Absent when the presets could not be read. */
  listErrorMessage?: string;
  presets: readonly ReaderIconPresetItem[];
  tenantId: string;
}

/**
 * The icons the tenant offers readers to pick under the preset policy, each
 * drawn the way the site draws an icon, with the renditions stored for it.
 * Presets can be added under any policy, so a tenant fills the set before it
 * switches to it.
 */
export const ReaderIconPresetGallery = async ({
  canEdit,
  listErrorMessage,
  presets,
  tenantId,
}: ReaderIconPresetGalleryProps) => {
  const t = await getMessages();
  // A list that could not be read says nothing about the count, so the upload
  // stays open and the API is what refuses one past the limit.
  const atLimit =
    !listErrorMessage && presets.length >= READER_ICON_PRESET_LIMIT;
  const uploadDisabled = !canEdit || atLimit;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.reader_icons.presets.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message
                message="admin.settings.reader_icons.presets.description"
                values={{ limit: READER_ICON_PRESET_LIMIT }}
              />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.settings.reader_icons.presets.list_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}

      {!listErrorMessage && presets.length === 0 ? (
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message message="admin.settings.reader_icons.presets.empty_title" />
              </Suspense>
            </EmptyStateTitle>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.reader_icons.presets.empty_description" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyStateHeading>
        </EmptyState>
      ) : null}

      {presets.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {presets.map((preset, index) => {
            const position = index + 1;
            const [largest] = preset.variants;

            return (
              <li
                key={preset.id}
                className="grid justify-items-center gap-2 border-t border-border pt-4"
              >
                <ReaderIcon
                  alt={t("admin.settings.reader_icons.presets.image_alt", {
                    position,
                  })}
                  icon={
                    largest
                      ? {
                          height: largest.height,
                          url: largest.url,
                          width: largest.width,
                        }
                      : null
                  }
                  size={64}
                />
                <ul className="grid justify-items-center text-xs text-muted-foreground tabular-nums">
                  {preset.variants.map((variant) => (
                    <li key={variant.url}>
                      <Suspense
                        fallback={<SkeletonLine className="h-3 w-20" />}
                      >
                        <Message
                          message="admin.settings.reader_icons.presets.variant_size"
                          values={{
                            height: variant.height,
                            width: variant.width,
                          }}
                        />
                      </Suspense>
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <ReaderIconPresetDeleteButton
                    position={position}
                    presetId={preset.id}
                    tenantId={tenantId}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <ActionForm
        action={uploadReaderIconPresetAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset disabled={uploadDisabled}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.reader_icons.presets.file" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="icon"
                type="file"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.reader_icons.presets.file_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {canEdit && atLimit ? (
          <FormMessage>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="admin.settings.reader_icons.presets.limit_reached"
                values={{ limit: READER_ICON_PRESET_LIMIT }}
              />
            </Suspense>
          </FormMessage>
        ) : null}

        <div className="flex justify-end gap-2">
          <ActionFormSubmit disabled={uploadDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionFormIdle>
                <Message message="admin.settings.reader_icons.presets.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.reader_icons.presets.uploading" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
