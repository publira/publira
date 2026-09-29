# QrCode

A QR code for a camera to read: an enrollment URI in the admin console, a store listing on the public site.

`toQrCodePath()` turns the text into SVG path data in module units, quiet zone included, and `QrCode` draws it. They are split so the geometry can be computed on the server and handed to a Client Component as one string and a number. The code is always black on white, whatever the theme, because an inverted code is not reliably scannable.

## Usage

```tsx
import { QrCode, toQrCodePath } from "@publira/ui-components/qr-code";

export default function Example() {
  const qr = toQrCodePath("https://apps.apple.com/app/id123");

  return <QrCode aria-label="Scan to open the App Store" {...qr} />;
}
```

## Subpath import

```tsx
import { QrCode, toQrCodePath } from "@publira/ui-components/qr-code";
```

## Props

`QrCode` takes the `path` and `size` `toQrCodePath()` returns, and the props of an `<svg>` apart from `viewBox` and `children`. With an `aria-label` it is exposed as one image by that name; without one it is hidden from assistive technology, for a code whose purpose the text beside it already names. It is `size-44` unless a `className` sizes it.
