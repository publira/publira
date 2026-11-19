import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
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
  <ActionForm.Root
    action={linkCreatorAccountAction}
    className="grid gap-4"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="creator_id" type="hidden" value={creatorId} />
    <input name="creator_public_id" type="hidden" value={creatorPublicId} />
    <SettledToast />
    <ActionForm.Fieldset>
      <Field.Root>
        <Field.Label required>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.creators.accounts.reader" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <CreatorAccountReaderField />
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creators.accounts.reader_description" />
            </Suspense>
          </Field.Description>
        </Field.Content>
      </Field.Root>
    </ActionForm.Fieldset>
    <div className="flex justify-end">
      <ActionForm.Submit>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <ActionForm.Idle>
            <Message message="admin.creators.accounts.link" />
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Message message="admin.creators.accounts.linking" />
          </ActionForm.Pending>
        </Suspense>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
