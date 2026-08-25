"use client";

import { cn } from "@publira/utils";
import Image from "next/image";
import { useState } from "react";

import type { TenantImageVariant } from "#lib/tenant";

interface TenantBrandLogoProps {
  alt: string;
  className?: string;
  fallbackLabel: string;
  priority?: boolean;
  variant: TenantImageVariant;
}

export const TenantBrandLogo = ({
  alt,
  className,
  fallbackLabel,
  priority = false,
  variant,
}: TenantBrandLogoProps) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return fallbackLabel;
  }

  return (
    <Image
      alt={alt}
      className={cn("h-8 w-auto max-w-[9rem] object-contain", className)}
      height={variant.height}
      onError={() => setFailed(true)}
      priority={priority}
      sizes="144px"
      src={variant.url}
      width={variant.width}
    />
  );
};
