import { describe, expect, it } from "vitest";

import { toQrCodePath } from "./qr-code";

/** An enrollment URI of the shape `StartMfaEnrollment` answers with. */
const OTPAUTH_URI = `otpauth://totp/Publira:admin@example.com?${new URLSearchParams(
  {
    algorithm: "SHA1",
    digits: "6",
    issuer: "Publira",
    period: "30",
    secret: "JBSWY3DPEHPK3PXP",
  }
).toString()}`;

/** The quiet zone `toQrCodePath` leaves around the code, in modules. */
const QUIET_ZONE = 4;

/** The smallest QR code is 21 modules wide, before the quiet zone. */
const SMALLEST_QR_MODULES = 21;

const drawsModuleAt = (path: string, x: number, y: number): boolean =>
  path.includes(`M${x} ${y}h1v1h-1z`);

const isInQuietZone = (x: number, y: number, size: number): boolean =>
  x < QUIET_ZONE ||
  y < QUIET_ZONE ||
  x >= size - QUIET_ZONE ||
  y >= size - QUIET_ZONE;

describe("toQrCodePath", () => {
  it("draws the code as one-unit squares inside a square viewBox", () => {
    const { path, size } = toQrCodePath(OTPAUTH_URI);

    expect(path.split("h1v1h-1z").length - 1).toBeGreaterThan(0);
    expect(size).toBeGreaterThanOrEqual(SMALLEST_QR_MODULES + 2 * QUIET_ZONE);
  });

  it("keeps the quiet zone a scanner needs clear of modules", () => {
    const { path, size } = toQrCodePath(OTPAUTH_URI);

    const coordinates = Array.from({ length: size }, (_, index) => index);
    const drawnInQuietZone = coordinates.flatMap((y) =>
      coordinates
        .filter((x) => isInQuietZone(x, y, size) && drawsModuleAt(path, x, y))
        .map((x) => `${x},${y}`)
    );

    expect(drawnInQuietZone).toEqual([]);
  });

  it("encodes different URIs differently", () => {
    expect(toQrCodePath(OTPAUTH_URI).path).not.toBe(
      toQrCodePath(`${OTPAUTH_URI}&x=1`).path
    );
  });
});
