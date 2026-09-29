import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { CreateAnnouncementActionState } from "../announcement-types";
import {
  AnnouncementPinned,
  AnnouncementPinnedCheckbox,
  AnnouncementPinnedWhile,
} from "./announcement-pinned-controls";

interface AnnouncementFormProps {
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
  tenantId: string;
  /** The tenant's display zone, which the banner's stop time is written in. */
  timeZone: string;
}

/**
 * Awaits the catalog for its placeholders, which are attributes rather than
 * nodes. A delivery redirects from the Action to the list.
 */
export const AnnouncementForm = async ({
  action,
  tenantId,
  timeZone,
}: AnnouncementFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionFormFieldset className="grid gap-5">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.announcements.form.title" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              maxLength={120}
              name="title"
              placeholder={t("admin.announcements.form.title_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.announcements.form.body" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              maxLength={2000}
              name="body"
              placeholder={t("admin.announcements.form.body_placeholder")}
              required
              rows={5}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.announcements.form.link" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              name="link_url"
              placeholder={t("admin.announcements.form.link_placeholder")}
              type="text"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.announcements.form.link_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <AnnouncementPinned>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.announcements.form.pinned" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <AnnouncementPinnedCheckbox />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.announcements.form.pinned_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <AnnouncementPinnedWhile>
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.announcements.form.pinned_until" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <InstantInput
                  name="pinned_until"
                  step={60}
                  timeZone={timeZone}
                />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.announcements.form.pinned_until_description"
                      values={{ time_zone: timeZone }}
                    />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>
          </AnnouncementPinnedWhile>
        </AnnouncementPinned>
      </ActionFormFieldset>

      <div className="flex justify-end">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.announcements.form.submit" />
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
