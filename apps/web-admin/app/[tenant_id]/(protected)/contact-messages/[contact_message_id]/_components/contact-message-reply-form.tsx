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

import { Message } from "#components/message";

import type { ContactMessageItem } from "../../contact-message-types";
import { CONTACT_MESSAGE_REPLY_MAX_LENGTH } from "../../contact-message-types";
import { replyToContactMessageAction } from "../_lib/actions";

interface ContactMessageReplyFormProps {
  contactMessage: Pick<
    ContactMessageItem,
    "entryCount" | "id" | "publicId" | "replyToEmail"
  >;
  tenantId: string;
}

/**
 * The answer a member of staff sends from the console, under the exchange it
 * joins.
 *
 * The reader's reply comes back to the account address of whoever answered,
 * because that is the `Reply-To` the API gives the mail, so the hint says so
 * rather than leaving staff to guess which mailbox to watch.
 */
export const ContactMessageReplyForm = ({
  contactMessage,
  tenantId,
}: ContactMessageReplyFormProps) => (
  <ActionForm
    action={replyToContactMessageAction}
    className="grid gap-4 sm:max-w-2xl"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="contact_message_id" type="hidden" value={contactMessage.id} />
    <input name="public_id" type="hidden" value={contactMessage.publicId} />
    <ActionFormFieldset>
      <Field>
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.reply.label" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          {/* Keyed by the length of the exchange so the field is emptied once
              the answer it held has been read back as an entry. No maxLength:
              the browser counts UTF-16 code units, and the Action checks the
              limit in characters as the API does. */}
          <Textarea
            key={contactMessage.entryCount}
            name="body"
            required
            rows={6}
          />
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message
                message="admin.contact_messages.reply.hint"
                values={{
                  count: String(CONTACT_MESSAGE_REPLY_MAX_LENGTH),
                  email: contactMessage.replyToEmail,
                }}
              />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>
    </ActionFormFieldset>

    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ActionFormIdle>
            <Message message="admin.contact_messages.reply.submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.contact_messages.reply.sending" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
