import { afterEach, describe, expect, it } from "vitest";

import {
  reserveUploadBytes,
  TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES,
  UPLOADS_IN_FLIGHT_MAX_BYTES,
} from "#lib/upload-allowance";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const TENANT_C = "33333333-3333-4333-8333-333333333333";

const held: (() => void)[] = [];

/** Reserves as a route would, and stops counting it after the test. */
const reserve = (tenantId: string, bytes: number) => {
  const release = reserveUploadBytes(tenantId, bytes);

  if (release) {
    held.push(release);
  }

  return release;
};

describe("reserveUploadBytes", () => {
  afterEach(() => {
    for (const release of held.splice(0)) {
      release();
    }
  });

  it("takes uploads up to the tenant's share, and refuses the one past it", () => {
    expect(
      reserve(TENANT_A, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES - 1)
    ).not.toBeNull();
    expect(reserve(TENANT_A, 1)).not.toBeNull();
    expect(reserve(TENANT_A, 1)).toBeNull();
  });

  it("leaves another tenant's share alone when one tenant's is full", () => {
    reserve(TENANT_A, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES);

    expect(
      reserve(TENANT_B, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES)
    ).not.toBeNull();
  });

  it("refuses every tenant once the process holds its sum", () => {
    const tenants = [TENANT_A, TENANT_B];

    expect(
      tenants.length * TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES
    ).toBeGreaterThanOrEqual(UPLOADS_IN_FLIGHT_MAX_BYTES);

    for (const tenantId of tenants) {
      reserve(tenantId, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES);
    }

    expect(reserve(TENANT_C, 1)).toBeNull();
  });

  it("counts nothing for an upload it refuses", () => {
    reserve(TENANT_A, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES);
    reserve(TENANT_B, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES);

    expect(reserve(TENANT_C, 1)).toBeNull();

    held.pop()?.();

    expect(
      reserve(TENANT_C, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES)
    ).not.toBeNull();
  });

  it("gives the bytes back once, however often the release is called", () => {
    const first = reserveUploadBytes(
      TENANT_A,
      TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES
    );

    expect(first).not.toBeNull();

    first?.();
    first?.();

    expect(
      reserve(TENANT_A, TENANT_UPLOADS_IN_FLIGHT_MAX_BYTES)
    ).not.toBeNull();
    expect(reserve(TENANT_A, 1)).toBeNull();
  });
});
