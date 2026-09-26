import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformStorageSettings } from "#lib/storage-settings-shared";

import {
  testPlatformStorageConnectionAction,
  updatePlatformStorageSettingsAction,
} from "../_lib/actions";
import { StorageConnectionTest } from "./storage-connection-test";
import { StorageCredentialFields } from "./storage-credential-fields";

interface StorageSettingsFormProps {
  loadErrorMessage?: string;
  settings: PlatformStorageSettings;
}

export const StorageSettingsForm = ({
  loadErrorMessage,
  settings,
}: StorageSettingsFormProps) => {
  const isUnconfigured = !loadErrorMessage && settings.revision === "0";

  return (
    <PlatformSection>
      <PlatformSectionHeader>
        <PlatformSectionHeading>
          <PlatformSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="platform.storage.title" />
            </Suspense>
          </PlatformSectionTitle>
          <PlatformSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="platform.storage.description" />
            </Suspense>
          </PlatformSectionDescription>
        </PlatformSectionHeading>
      </PlatformSectionHeader>

      {loadErrorMessage ? (
        <FormMessage className="sm:max-w-3xl" variant="destructive">
          {loadErrorMessage}
        </FormMessage>
      ) : null}
      {isUnconfigured ? (
        <FormMessage className="sm:max-w-3xl" variant="warning">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.storage.unconfigured" />
          </Suspense>
        </FormMessage>
      ) : null}

      <ActionForm
        action={updatePlatformStorageSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="revision" type="hidden" value={settings.revision} />

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.storage.form.bucket" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              defaultValue={settings.bucket}
              disabled={Boolean(loadErrorMessage)}
              name="bucket"
              placeholder="publira-media"
              required
              spellCheck={false}
              type="text"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="platform.storage.form.bucket_help" />
            </Suspense>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="platform.storage.form.region" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              defaultValue={settings.region}
              disabled={Boolean(loadErrorMessage)}
              name="region"
              placeholder="us-east-1"
              required
              spellCheck={false}
              type="text"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="platform.storage.form.region_help" />
            </Suspense>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.storage.form.public_base_url" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              defaultValue={settings.publicBaseUrl}
              disabled={Boolean(loadErrorMessage)}
              name="public_base_url"
              placeholder="https://media.example.com"
              spellCheck={false}
              type="url"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="platform.storage.form.public_base_url_help" />
            </Suspense>
          </FieldDescription>
        </Field>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium text-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <Message message="platform.storage.form.advanced_legend" />
            </Suspense>
          </legend>
          <p className="text-xs text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
              <Message message="platform.storage.form.advanced_help" />
            </Suspense>
          </p>

          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="platform.storage.form.endpoint" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                autoComplete="off"
                defaultValue={settings.endpoint}
                disabled={Boolean(loadErrorMessage)}
                name="endpoint"
                placeholder="https://s3.example.com"
                spellCheck={false}
                type="url"
              />
            </FieldContent>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                <Message message="platform.storage.form.endpoint_help" />
              </Suspense>
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center gap-2">
              <Checkbox
                defaultChecked={settings.forcePathStyle}
                disabled={Boolean(loadErrorMessage)}
                name="force_path_style"
              />
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="platform.storage.form.force_path_style" />
                </Suspense>
              </FieldLabel>
            </div>
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
                <Message message="platform.storage.form.force_path_style_help" />
              </Suspense>
            </FieldDescription>
          </Field>
        </fieldset>

        <StorageCredentialFields key={settings.revision} settings={settings} />

        <StorageConnectionTest action={testPlatformStorageConnectionAction} />

        <div className="flex justify-end">
          <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.storage.save" />
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </PlatformSection>
  );
};
