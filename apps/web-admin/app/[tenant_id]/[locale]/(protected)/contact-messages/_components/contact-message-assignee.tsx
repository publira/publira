import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { ContactMessageItem } from "../contact-message-types";

/**
 * Who the message is assigned to, or that nobody is. It names the assignee
 * only, never whoever marked the message handled: a handled message keeps the
 * assignee it had, and the two are often different people.
 */
export const ContactMessageAssignee = ({
  message,
}: {
  message: Pick<
    ContactMessageItem,
    "assigneeName" | "assigneePublicId" | "assigneeUserId"
  >;
}) => {
  if (!message.assigneeUserId) {
    return (
      <span className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.contact_messages.assignee_none" />
        </Suspense>
      </span>
    );
  }

  return message.assigneeName || message.assigneePublicId;
};
