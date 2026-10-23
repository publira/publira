import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
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
import type { PlatformWebPushSettings } from "#lib/webpush-settings";

import { updatePlatformWebPushSubjectAction } from "../_lib/actions";

interface WebPushSettingsFormProps {
  loadErrorMessage?: string;
  settings: PlatformWebPushSettings;
}

export const WebPushSettingsForm = ({
  loadErrorMessage,
  settings,
}: WebPushSettingsFormProps) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="platform.webpush.title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.webpush.description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}
    {!loadErrorMessage && settings.configured ? (
      <FormMessage className="sm:max-w-3xl" variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="platform.webpush.configured" />
        </Suspense>
      </FormMessage>
    ) : null}
    {loadErrorMessage || settings.configured ? null : (
      <FormMessage className="sm:max-w-3xl" variant="warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="platform.webpush.unconfigured" />
        </Suspense>
      </FormMessage>
    )}

    <ActionForm.Root
      action={updatePlatformWebPushSubjectAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="revision" type="hidden" value={settings.revision} />

      {/* A save refreshes the settings; the new revision remounts the field
          instead of changing a mounted field's default. */}
      <Field.Root key={settings.revision}>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="platform.webpush.form.subject" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            autoComplete="off"
            defaultValue={settings.subject}
            disabled={Boolean(loadErrorMessage)}
            name="subject"
            placeholder="mailto:push@example.com"
            required
            spellCheck={false}
            type="text"
          />
        </Field.Content>
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
            <Message message="platform.webpush.form.subject_help" />
          </Suspense>
        </Field.Description>
      </Field.Root>

      <div className="flex justify-end">
        <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.webpush.save" />
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </PlatformSection>
);
