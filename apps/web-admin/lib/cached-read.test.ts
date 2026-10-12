import { Code, ConnectError } from "@publira/api-client/errors";
import { describe, expect, it } from "vitest";

import {
  rebuildCaughtReadError,
  settleCachedRead,
  toCaughtReadError,
} from "./cached-read";

describe("settleCachedRead", () => {
  it("returns a result without the verdict", () => {
    expect(settleCachedRead({ ok: true, unexpected: false, value: 1 })).toEqual(
      { ok: true, value: 1 }
    );
  });

  it("returns a failure the screen has copy for", () => {
    expect(settleCachedRead({ message: "Could not load.", ok: false })).toEqual(
      { message: "Could not load.", ok: false }
    );
  });

  it("throws an unexpected failure with its message", () => {
    expect(() =>
      settleCachedRead({
        message: "Could not load.",
        ok: false,
        unexpected: true,
      })
    ).toThrow("Could not load.");
  });
});

describe("rebuildCaughtReadError", () => {
  it("rebuilds an RPC error with its code and its own message", () => {
    const rebuilt = rebuildCaughtReadError(
      toCaughtReadError(
        new ConnectError(
          "connect ECONNREFUSED 127.0.0.1:8080",
          Code.Unavailable
        )
      )
    );

    expect(rebuilt).toBeInstanceOf(ConnectError);
    expect(rebuilt.message).toBe(
      "[unavailable] connect ECONNREFUSED 127.0.0.1:8080"
    );
  });

  it("rebuilds any other error as a plain error with its message", () => {
    const rebuilt = rebuildCaughtReadError(
      toCaughtReadError(new TypeError("not an RPC error"))
    );

    expect(rebuilt).not.toBeInstanceOf(ConnectError);
    expect(rebuilt.message).toBe("not an RPC error");
  });

  it("carries the error as plain data", () => {
    expect(
      toCaughtReadError(new ConnectError("boom", Code.Internal))
    ).toStrictEqual({ code: Code.Internal, message: "boom" });
  });
});
