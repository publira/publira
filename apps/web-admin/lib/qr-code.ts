/**
 * QR codes for the screen, as SVG geometry rather than markup.
 *
 * The enrollment URI is produced by a Server Action and drawn by a Client
 * Component, so what crosses that boundary is one path string and the module
 * count — not the matrix (thousands of booleans) and not a blob of SVG that
 * would have to be injected as raw HTML.
 */

import { encode } from "uqr";

export interface QrCodePath {
  /** SVG path data in module units, for a `viewBox` of `0 0 size size`. */
  path: string;
  /** Width of the matrix in modules, quiet zone included. */
  size: number;
}

/** The quiet zone every QR code needs to be scannable (ISO/IEC 18004). */
const QUIET_ZONE_MODULES = 4;

export const toQrCodePath = (text: string): QrCodePath => {
  const { data, size } = encode(text, { border: QUIET_ZONE_MODULES });

  const modules: string[] = [];
  for (const [y, row] of data.entries()) {
    for (const [x, filled] of row.entries()) {
      if (filled) {
        modules.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }

  return { path: modules.join(""), size };
};
