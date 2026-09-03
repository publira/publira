import type { QrCodePath } from "#lib/qr-code";

interface QrCodeProps extends QrCodePath {
  /** What the code is for, for a reader who cannot see it. */
  label: string;
}

/**
 * A QR code drawn from the geometry `toQrCodePath()` produced.
 *
 * The colours are fixed rather than themed: a camera reads dark modules on a
 * light field, and an inverted code — which is what a dark-theme token would
 * produce — is not reliably scannable. The white field is part of the code,
 * not decoration around it.
 *
 * The drawing itself is hidden from assistive technology and the label is real
 * text beside it: a QR code is only useful to a camera, so what a screen reader
 * needs is the name of the thing, not its geometry.
 */
export const QrCode = ({ label, path, size }: QrCodeProps) => (
  <div>
    <svg
      aria-hidden="true"
      className="h-44 w-44 rounded-md"
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#ffffff" height={size} width={size} x="0" y="0" />
      <path d={path} fill="#000000" />
    </svg>
    <span className="sr-only">{label}</span>
  </div>
);
