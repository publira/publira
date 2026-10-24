"use client";

import Image from "next/image";
import { useState } from "react";

import type { TenantImageVariant } from "#lib/tenant";

import { SignInPanelGround } from "./sign-in-panel-ground";

/**
 * The tenant's sign-in image, cropped to the panel. The server keeps the
 * upload's proportions, so the crop is decided here as the window changes
 * shape.
 *
 * `alt` is empty because the panel is decoration: whatever the image shows, the
 * screen beside it reads the same without it. An image that fails to load gives
 * way to the tenant's colours, so the half is never left blank.
 *
 * Loaded lazily: below `lg` the panel is `display: none`, and a lazy image
 * there is never fetched, so a phone spends nothing on it.
 */
export const SignInPanelImage = ({
  variant,
}: {
  variant: TenantImageVariant;
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <SignInPanelGround />;
  }

  return (
    <div className="relative size-full">
      <Image
        alt=""
        className="object-cover"
        fill
        onError={() => setFailed(true)}
        sizes="50vw"
        src={variant.url}
      />
    </div>
  );
};
