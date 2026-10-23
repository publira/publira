import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { ContactMessageItem } from "../../contact-message-types";
import { CONTACT_MESSAGE_REPLY_MAX_LENGTH } from "../../contact-message-types";
import { replyToContactMessageAction } from "../_lib/actions";

/**
 * Where the reader's reply to an answer comes back: under the message once the
 * tenant's inbound email is ready, because the answer's `Reply-To` is then the
 * message's own address on the inbound domain, and to the account address of
 * whoever answered otherwise. `unknown` is settings that could not be read,
 * for which the hint names neither, since either could send staff to the wrong
 * mailbox.
 */
export type ContactMessageReplyRoute = "inbound" | "staff" | "unknown";

interface ContactMessageReplyFormProps {
  contactMessage: Pick<
    ContactMessageItem,
    "entryCount" | "id" | "publicId" | "replyToEmail"
  >;
  replyRoute: ContactMessageReplyRoute;
  tenantId: string;
}

/**
 * The answer a member of staff sends from the console, under the exchange it
 * joins, with a hint that says where the reader's reply will come back rather
 * than leaving staff to guess which mailbox to watch.
 */
export const ContactMessageReplyForm = ({
  contactMessage,
  replyRoute,
  tenantId,
}: ContactMessageReplyFormProps) => (
  <ActionForm.Root
    action={replyToContactMessageAction}
    className="grid gap-4 sm:max-w-2xl"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="contact_message_id" type="hidden" value={contactMessage.id} />
    <input name="public_id" type="hidden" value={contactMessage.publicId} />
    <ActionForm.Fieldset>
      <Field.Root>
        <Field.Label>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.reply.label" />
          </Suspense>
        </Field.Label>
        <Field.Content>
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
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
              <Message
                message="admin.contact_messages.reply.hint"
                values={{
                  count: String(CONTACT_MESSAGE_REPLY_MAX_LENGTH),
                  email: contactMessage.replyToEmail,
                  reply_route: replyRoute,
                }}
              />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </ActionForm.Fieldset>

    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ActionForm.Idle>
            <Message message="admin.contact_messages.reply.submit" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.contact_messages.reply.sending" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
