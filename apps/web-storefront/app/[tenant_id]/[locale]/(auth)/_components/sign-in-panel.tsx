import * as AuthScreen from "@publira/layouts/auth-screen";
import { Suspense } from "react";

import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { resolveTenantSignInImageVariant } from "#lib/tenant-sign-in-image";

import { SignInPanelGround } from "./sign-in-panel-ground";
import { SignInPanelImage } from "./sign-in-panel-image";

/**
 * The tenant's image, or its colours while it has none. A tenant read that
 * fails answers `null`, which is the same as having no image: the panel is
 * decoration, and the form beside it is what the screen is for.
 */
const SignInPanelContent = async () => {
  const tenantInfo = await getTenantSiteInfo(await getTenantId());
  const variant = resolveTenantSignInImageVariant(tenantInfo);

  return variant ? (
    <SignInPanelImage variant={variant} />
  ) : (
    <SignInPanelGround />
  );
};

/**
 * What every screen under `(auth)` puts beside its form.
 *
 * The panel waits on the tenant read behind a boundary of its own, so the form
 * keeps the static shell. The fallback is nothing over the panel's own
 * surface: a skeleton the size of half the window would pulse for the whole
 * wait, and the tenant's colours in its place would flash before the image
 * that replaces them.
 */
export const SignInPanel = () => (
  <AuthScreen.Panel>
    <Suspense fallback={null}>
      <SignInPanelContent />
    </Suspense>
  </AuthScreen.Panel>
);
