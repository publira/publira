import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import type { PageVersionListItem } from "../page-types";

interface PagePublishFormProps {
  /**
   * Whether publishing can ask readers to agree to the version again: the page
   * is the tenant's terms of service or privacy policy, and the member of staff
   * is a tenant admin, the one role the API lets ask.
   */
  asksReadersToAgree: boolean;
  disabled: boolean;
  pageId: string;
  publishAction: (formData: FormData) => Promise<void>;
  tenantId: string;
  translationLocale: string;
  version: PageVersionListItem;
}

/**
 * A version row's **Publish**. On a page readers agree to, it asks first
 * whether this version is one they have to agree to again or a correction that
 * leaves their agreement standing, since the same button serves both and only
 * the publisher knows which the edit was.
 */
export const PagePublishForm = ({
  asksReadersToAgree,
  disabled,
  pageId,
  publishAction,
  tenantId,
  translationLocale,
  version,
}: PagePublishFormProps) => {
  const formId = `publish-page-version-${version.id}`;
  const label = (
    <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
      <Message message="admin.pages.workspace.publish" />
    </Suspense>
  );

  return (
    <form action={publishAction} id={formId}>
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="page_id" type="hidden" value={pageId} />
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale}
      />
      <input name="version_id" type="hidden" value={version.id} />
      {asksReadersToAgree ? (
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            disabled={disabled}
            render={<Button type="button" variant="outline" />}
          >
            {label}
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message
                    message="admin.pages.workspace.publish_agreement.title"
                    values={{ version: `v${version.versionNumber}` }}
                  />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.pages.workspace.publish_agreement.description" />
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            {/* Three buttons do not fit the dialog's width in a row, so they stack, the choice that asks on top. */}
            <ConfirmDialog.Footer className="sm:flex-col-reverse">
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action
                form={formId}
                name="require_agreement"
                value="false"
                variant="outline"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="admin.pages.workspace.publish_agreement.correction" />
                </Suspense>
              </ConfirmDialog.Action>
              <ConfirmDialog.Action
                form={formId}
                name="require_agreement"
                value="true"
                variant="default"
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.pages.workspace.publish_agreement.require" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      ) : (
        <Button disabled={disabled} type="submit" variant="outline">
          {label}
        </Button>
      )}
    </form>
  );
};
