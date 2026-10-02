import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionActions,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getMessagesFor } from "#lib/messages";

import type {
  ContactMessageAssigneeOption,
  ContactMessageItem,
} from "../../contact-message-types";
import { assignContactMessageAction } from "../_lib/actions";

interface ContactMessageAssignmentProps {
  /** Every member of staff the message can be assigned to. */
  assignees: ContactMessageAssigneeOption[];
  /** Why the assignees could not be read, which closes the controls. */
  assigneesErrorMessage?: string;
  contactMessage: Pick<
    ContactMessageItem,
    "assigneeName" | "assigneePublicId" | "assigneeUserId" | "id" | "publicId"
  >;
  /** The signed-in account's public id, which "Assign to me" looks up. */
  currentUserPublicId: string;
  locale: Locale;
  tenantId: string;
}

const HiddenFields = ({
  contactMessage,
  tenantId,
}: Pick<ContactMessageAssignmentProps, "contactMessage" | "tenantId">) => (
  <>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="contact_message_id" type="hidden" value={contactMessage.id} />
    <input name="public_id" type="hidden" value={contactMessage.publicId} />
  </>
);

/**
 * The picker's options: nobody first, which is how an assignment is cleared,
 * then every member of staff.
 *
 * An assignee who has since lost the role is still offered, so the picker
 * shows who the message is with instead of a blank; saving them again is
 * refused by the API like any other account that cannot open the inbox.
 */
const assigneeItems = async (
  assignees: ContactMessageAssigneeOption[],
  contactMessage: ContactMessageAssignmentProps["contactMessage"],
  locale: Locale
): Promise<{ label: string; value: string }[]> => {
  const t = await getMessagesFor(locale);
  const items = assignees.map((assignee) => ({
    label: assignee.name || assignee.userPublicId,
    value: assignee.userId,
  }));
  if (
    contactMessage.assigneeUserId &&
    !items.some((item) => item.value === contactMessage.assigneeUserId)
  ) {
    items.push({
      label: contactMessage.assigneeName || contactMessage.assigneePublicId,
      value: contactMessage.assigneeUserId,
    });
  }

  return [
    { label: t("admin.contact_messages.assignee_none"), value: "" },
    ...items,
  ];
};

/**
 * Who is working on the message: a picker that assigns, moves, or clears it,
 * and a one-press "Assign to me" for the member of staff reading it.
 *
 * Neither asks for confirmation: an assignment takes nothing away, and the
 * picker puts back whatever was there before.
 */
export const ContactMessageAssignment = async ({
  assignees,
  assigneesErrorMessage,
  contactMessage,
  currentUserPublicId,
  locale,
  tenantId,
}: ContactMessageAssignmentProps) => {
  const self = assignees.find(
    (assignee) => assignee.userPublicId === currentUserPublicId
  );
  const canAssignSelf =
    !assigneesErrorMessage &&
    self !== undefined &&
    self.userId !== contactMessage.assigneeUserId;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
              <Message message="admin.contact_messages.assignment.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.contact_messages.assignment.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
        {canAssignSelf ? (
          <AdminSectionActions>
            <ActionForm action={assignContactMessageAction}>
              <HiddenFields
                contactMessage={contactMessage}
                tenantId={tenantId}
              />
              <input
                name="assignee_user_id"
                type="hidden"
                value={self.userId}
              />
              <ActionFormSubmit variant="outline">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <ActionFormIdle>
                    <Message message="admin.contact_messages.assignment.assign_to_me" />
                  </ActionFormIdle>
                  <ActionFormPending>
                    <Message message="admin.contact_messages.assignment.assigning" />
                  </ActionFormPending>
                </Suspense>
              </ActionFormSubmit>
            </ActionForm>
          </AdminSectionActions>
        ) : null}
      </AdminSectionHeader>

      <ActionForm
        action={assignContactMessageAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <HiddenFields contactMessage={contactMessage} tenantId={tenantId} />
        <ActionFormFieldset disabled={Boolean(assigneesErrorMessage)}>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.contact_messages.columns.assignee" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              {/* Keyed by the assignee so an assignment made from "Assign to
                  me" or by somebody else replaces the selection. */}
              <Select
                defaultValue={contactMessage.assigneeUserId}
                items={await assigneeItems(assignees, contactMessage, locale)}
                key={contactMessage.assigneeUserId}
                name="assignee_user_id"
              />
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        {assigneesErrorMessage ? (
          <FormMessage variant="destructive">
            {assigneesErrorMessage}
          </FormMessage>
        ) : null}

        <div className="flex justify-end">
          <ActionFormSubmit disabled={Boolean(assigneesErrorMessage)}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionFormIdle>
                <Message message="admin.contact_messages.assignment.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.contact_messages.assignment.assigning" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
