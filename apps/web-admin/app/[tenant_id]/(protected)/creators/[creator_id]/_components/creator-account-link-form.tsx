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
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { linkCreatorAccountAction } from "../../_lib/actions";
import { CreatorAccountReaderField } from "./creator-account-reader-field";

interface CreatorAccountLinkFormProps {
  creatorId: string;
  creatorPublicId: string;
  tenantId: string;
}

export const CreatorAccountLinkForm = ({
  creatorId,
  creatorPublicId,
  tenantId,
}: CreatorAccountLinkFormProps) => (
  <ActionForm
    action={linkCreatorAccountAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="creator_id" type="hidden" value={creatorId} />
    <input name="creator_public_id" type="hidden" value={creatorPublicId} />
    <SettledToast />
    <ActionFormFieldset>
      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.creators.accounts.reader" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <CreatorAccountReaderField />
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creators.accounts.reader_description" />
            </Suspense>
          </FieldDescription>
        </FieldContent>
      </Field>
    </ActionFormFieldset>
    <div className="flex justify-end">
      <ActionFormSubmit>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ActionFormIdle>
            <Message message="admin.creators.accounts.link" />
          </ActionFormIdle>
          <ActionFormPending>
            <Message message="admin.creators.accounts.linking" />
          </ActionFormPending>
        </Suspense>
      </ActionFormSubmit>
    </div>
  </ActionForm>
);
