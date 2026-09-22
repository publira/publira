import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef } from "react";

import type { QrCodePath } from "./qr-code-path";

export type QrCodeProps = QrCodePath &
  Omit<ComponentPropsWithoutRef<"svg">, "children" | "viewBox">;

/**
 * A QR code drawn from the geometry `toQrCodePath()` produced.
 *
 * The colours are fixed rather than themed: a camera reads dark modules on a
 * light field, and an inverted code — which is what a dark-theme token would
 * produce — is not reliably scannable. The white field is part of the code,
 * not decoration around it.
 *
 * With an `aria-label` the code is one image by that name, and without one it
 * is hidden: a QR code is only useful to a camera, so what a screen reader
 * needs is the name of the thing, not its geometry.
 */
export const QrCode = ({
  "aria-label": label,
  className,
  path,
  size,
  ...props
}: QrCodeProps) => (
  <svg
    {...props}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    className={cn("size-44 rounded-control", className)}
    role={label ? "img" : undefined}
    viewBox={`0 0 ${size} ${size}`}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect fill="#ffffff" height={size} width={size} x="0" y="0" />
    <path d={path} fill="#000000" />
  </svg>
);
