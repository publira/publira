import {
  BadRequestSchema,
  ErrorInfoSchema,
} from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";
import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  Code,
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isRpcError,
  isUnauthenticatedRpcError,
  rpcErrorCode,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "./errors";

/**
 * Stands in for an error that crossed a `"use cache"` boundary: Next.js
 * re-creates it from `name` and `message`, so `code` / `rawMessage` are gone.
 */
const rehydratedConnectError = (message: string): Error => {
  const error = new Error(message);
  error.name = "ConnectError";
  return error;
};

describe("rpcErrorCode", () => {
  it("a ConnectError exposes its code directly", () => {
    expect(rpcErrorCode(new ConnectError("gone", Code.NotFound))).toBe(
      Code.NotFound
    );
  });

  it("an error re-created at a cache boundary is restored from the message prefix", () => {
    expect(
      rpcErrorCode(rehydratedConnectError("[permission_denied] not published"))
    ).toBe(Code.PermissionDenied);
  });

  it("an error that did not come from an RPC is null", () => {
    expect(rpcErrorCode(new Error("boom"))).toBeNull();
    expect(rpcErrorCode("boom")).toBeNull();
    expect(rpcErrorCode(null)).toBeNull();
  });

  it("a code name inside the message body alone is not classified", () => {
    expect(rpcErrorCode(new Error("tenant not found"))).toBeNull();
    expect(rpcErrorCode(new Error("failed: not_found"))).toBeNull();
  });

  it("anything but a ConnectError stays unclassified even with the prefix", () => {
    // Otherwise any Error could disguise itself as an RPC failure and slip
    // past rethrowUnclassifiedRpcError().
    expect(
      rpcErrorCode(new Error("[not_found] looks like connect"))
    ).toBeNull();
    expect(
      rpcErrorDisposition(new Error("[not_found] looks like connect"))
    ).toBe("unexpected");
  });

  it("an unknown prefix is null", () => {
    expect(rpcErrorCode(new Error("[teapot] nope"))).toBeNull();
  });
});

describe("isRpcError", () => {
  it("matches any of the given codes", () => {
    const error = new ConnectError("nope", Code.PermissionDenied);
    expect(isRpcError(error, Code.NotFound, Code.PermissionDenied)).toBe(true);
    expect(isRpcError(error, Code.NotFound)).toBe(false);
  });
});

describe("rpcErrorDisposition", () => {
  it.each([
    [Code.NotFound, "not-found"],
    [Code.PermissionDenied, "forbidden"],
    [Code.Unauthenticated, "unauthenticated"],
    [Code.InvalidArgument, "invalid-argument"],
    [Code.OutOfRange, "invalid-argument"],
    [Code.AlreadyExists, "conflict"],
    [Code.Aborted, "conflict"],
    [Code.FailedPrecondition, "precondition"],
    [Code.Unavailable, "unavailable"],
    [Code.Internal, "unexpected"],
  ])("Code %s is %s", (code, expected) => {
    expect(rpcErrorDisposition(new ConnectError("x", code))).toBe(expected);
  });

  it("an error that did not come from an RPC is unexpected", () => {
    expect(rpcErrorDisposition(new TypeError("boom"))).toBe("unexpected");
  });
});

describe("shared policy", () => {
  it("not_found and permission_denied are both treated as missing", () => {
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.NotFound))
    ).toBe(true);
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.PermissionDenied))
    ).toBe(true);
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(false);
  });

  it("unauthenticated is separated out for the re-authentication path", () => {
    expect(
      isUnauthenticatedRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(true);
    expect(
      isUnauthenticatedRpcError(new ConnectError("x", Code.PermissionDenied))
    ).toBe(false);
  });

  it("a nullable read accepts only not_found, permission_denied, and unauthenticated", () => {
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(true);
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.InvalidArgument))
    ).toBe(false);
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.AlreadyExists))
    ).toBe(false);
    expect(isExpectedNullableRpcError(new Error("boom"))).toBe(false);
  });
});

describe("Connect error details", () => {
  it("reads a BadRequest field violation with its type", () => {
    const error = new ConnectError(
      "invalid slug",
      Code.InvalidArgument,
      undefined,
      [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "slug" }] },
        },
      ]
    );
    expect(rpcErrorHasFieldViolation(error, "slug")).toBe(true);
    expect(rpcErrorHasFieldViolation(error, "title")).toBe(false);
  });

  it("reads a Publira reason from ErrorInfo with its type", () => {
    const error = new ConnectError(
      "invitation canceled",
      Code.FailedPrecondition,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "publira",
            reason: "INVITATION_CANCELED",
          },
        },
      ]
    );
    expect(rpcErrorHasReason(error, "INVITATION_CANCELED")).toBe(true);
    expect(rpcErrorHasReason(error, "ARCHIVE_INVALID_PATH")).toBe(false);

    const foreignError = new ConnectError(
      "invitation canceled",
      Code.FailedPrecondition,
      undefined,
      [
        {
          desc: ErrorInfoSchema,
          value: {
            domain: "other-service",
            reason: "INVITATION_CANCELED",
          },
        },
      ]
    );

    expect(rpcErrorHasReason(foreignError, "INVITATION_CANCELED")).toBe(false);
  });

  it("a value that did not come from an RPC has no details", () => {
    expect(rpcErrorHasFieldViolation(new Error("bad"), "slug")).toBe(false);
    expect(
      rpcErrorHasReason(new Error("canceled"), "INVITATION_CANCELED")
    ).toBe(false);
  });
});
