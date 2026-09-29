"use client";

import { cn } from "@publira/utils";
import Image from "next/image";
import { useState } from "react";

import type { TenantBrandingImageVariant } from "#lib/tenant-branding-image";

interface TenantBrandLogoProps {
  alt: string;
  className?: string;
  priority?: boolean;
  variant: TenantBrandingImageVariant;
}

export const TenantBrandLogo = ({
  alt,
  className,
  priority = false,
  variant,
}: TenantBrandLogoProps) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <Image
      alt={alt}
      className={cn("h-8 w-auto max-w-[9rem] object-contain", className)}
      height={variant.height}
      onError={() => setFailed(true)}
      priority={priority}
      sizes="160px"
      src={variant.url}
      width={variant.width}
    />
  );
};
