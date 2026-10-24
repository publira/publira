import * as ActionForm from "@publira/ui-components/action-form";
import type { ReactNode } from "react";

import type { FollowTargetKind } from "#lib/follow";
import { toggleFollowAction } from "#lib/follow-actions";

import { FollowButtonState } from "./follow-button-state";
import { LocaleField } from "./locale-field";

/**
 * A toggle between following and not. The reader's current state decides
 * which of its two slots renders, so each carries the accessible name for its
 * own intent:
 *
 * ```tsx
 * <FollowButton.Root isFollowing={…} returnTo={…} targetId={…} targetKind="series" tenantId={…}>
 *   <FollowButton.Follow aria-label={t("storefront.follow.follow_aria", { name })}>
 *     <ActionForm.Idle>…</ActionForm.Idle>
 *     <ActionForm.Pending>…</ActionForm.Pending>
 *   </FollowButton.Follow>
 *   <FollowButton.Unfollow aria-label={t("storefront.follow.unfollow_aria", { name })}>
 *     …
 *   </FollowButton.Unfollow>
 * </FollowButton.Root>
 * ```
 */
const FollowButton = ({
  children,
  isFollowing,
  returnTo,
  targetId,
  targetKind,
  tenantId,
}: {
  /** `FollowButton.Follow` and `FollowButton.Unfollow`. */
  children: ReactNode;
  isFollowing: boolean;
  returnTo: string;
  /** The internal ID of the series or creator this follows. */
  targetId: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}) => (
  <ActionForm.Root
    action={toggleFollowAction}
    className="grid justify-items-start gap-2"
  >
    <LocaleField />
    <input name="returnTo" type="hidden" value={returnTo} />
    <input name="targetId" type="hidden" value={targetId} />
    <input name="targetKind" type="hidden" value={targetKind} />
    <input name="tenantId" type="hidden" value={tenantId} />
    <FollowButtonState isFollowing={isFollowing}>{children}</FollowButtonState>
  </ActionForm.Root>
);

export { FollowButton as Root };
export {
  FollowButtonFollow as Follow,
  FollowButtonUnfollow as Unfollow,
} from "./follow-button-state";
