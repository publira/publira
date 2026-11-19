import { Textarea } from "@publira/ui-components/textarea";

import { getMessages } from "#lib/get-messages";

/**
 * The reason field, which joins the form through `form=` from the dialog's
 * portal. A `placeholder` cannot be a node, so this one control resolves the
 * catalog itself and is the only thing the caller's `<Suspense>` covers.
 */
export const CommentReasonInput = async ({ formId }: { formId: string }) => {
  const t = await getMessages();

  return (
    <Textarea
      form={formId}
      name="reason"
      placeholder={t("admin.comments.reason_placeholder")}
    />
  );
};
