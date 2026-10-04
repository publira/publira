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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import type { ContactMessageItem } from "../../contact-message-types";
import { updateContactMessageStaffNoteAction } from "../_lib/actions";

interface ContactMessageStaffNoteProps {
  contactMessage: Pick<ContactMessageItem, "id" | "publicId" | "staffNote">;
  tenantId: string;
}

/**
 * The one internal note the staff share on a message: whatever is saved
 * replaces the note before it, and saving an empty note clears it.
 *
 * Clearing is the field emptied and saved rather than a button of its own, so
 * the note is never thrown away by a single press.
 */
export const ContactMessageStaffNote = ({
  contactMessage,
  tenantId,
}: ContactMessageStaffNoteProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
            <Message message="admin.contact_messages.staff_note.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.contact_messages.staff_note.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>

    <ActionForm
      action={updateContactMessageStaffNoteAction}
      className="grid gap-4 sm:max-w-2xl"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="contact_message_id"
        type="hidden"
        value={contactMessage.id}
      />
      <input name="public_id" type="hidden" value={contactMessage.publicId} />
      <ActionFormFieldset>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.contact_messages.staff_note.label" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            {/* Keyed by the note so one saved here or by somebody else
                replaces what the field holds once the page is read again. No
                maxLength: the browser counts UTF-16 code units, and the
                Action checks the limit in characters as the API does. */}
            <Textarea
              defaultValue={contactMessage.staffNote}
              key={contactMessage.staffNote}
              name="staff_note"
              rows={6}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.contact_messages.staff_note.hint" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end">
        <ActionFormSubmit>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionFormIdle>
              <Message message="admin.contact_messages.staff_note.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.contact_messages.staff_note.saving" />
            </ActionFormPending>
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
