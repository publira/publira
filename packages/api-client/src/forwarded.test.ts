import { createContextValues } from "@connectrpc/connect";
import type { ContextValues } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import type { ForwardedHeaders } from "./forwarded";
import {
  createForwardedInterceptor,
  forwardedHeadersOf,
  serviceCallContextValues,
} from "./forwarded";

const run = async (
  resolve: () => Promise<ForwardedHeaders>,
  header: Headers,
  contextValues: ContextValues = createContextValues()
) => {
  const next = vi.fn(() => Promise.resolve({ ok: true }));
  await createForwardedInterceptor(resolve)(next as never)({
    contextValues,
    header,
  } as never);
  expect(next).toHaveBeenCalledOnce();
};

describe("forwardedHeadersOf", () => {
  it("passes both headers on as they are", () => {
    expect(
      forwardedHeadersOf(
        new Headers({
          Forwarded: 'for=198.51.100.4;proto=https, for="[2001:db8::7]"',
          "X-Forwarded-For": "198.51.100.4, 192.0.2.3",
        })
      )
    ).toEqual({
      Forwarded: 'for=198.51.100.4;proto=https, for="[2001:db8::7]"',
      "X-Forwarded-For": "198.51.100.4, 192.0.2.3",
    });
  });

  it("leaves out a header the request did not carry", () => {
    expect(
      forwardedHeadersOf(new Headers({ Forwarded: "for=198.51.100.4" }))
    ).toEqual({ Forwarded: "for=198.51.100.4" });
    expect(forwardedHeadersOf(new Headers({ "X-Forwarded-For": " " }))).toEqual(
      {}
    );
  });
});

describe("createForwardedInterceptor", () => {
  it("passes the forwarded headers on with a call that carries a session", async () => {
    const header = new Headers({ Authorization: "Bearer session" });

    await run(
      () =>
        Promise.resolve({
          Forwarded: "for=203.0.113.7, for=192.0.2.3",
          "X-Forwarded-For": "203.0.113.7, 192.0.2.3",
        }),
      header
    );

    expect(header.get("Forwarded")).toBe("for=203.0.113.7, for=192.0.2.3");
    expect(header.get("X-Forwarded-For")).toBe("203.0.113.7, 192.0.2.3");
  });

  it("sends only the headers the request carried", async () => {
    const header = new Headers({ Authorization: "Bearer session" });

    await run(
      () => Promise.resolve({ Forwarded: "for=203.0.113.7, for=192.0.2.3" }),
      header
    );

    expect(header.get("Forwarded")).toBe("for=203.0.113.7, for=192.0.2.3");
    expect(header.has("X-Forwarded-For")).toBe(false);
  });

  it("does not read the request for a call without a session", async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ "X-Forwarded-For": "203.0.113.7" })
    );
    const header = new Headers();

    await run(resolve, header);

    expect(resolve).not.toHaveBeenCalled();
    expect(header.has("X-Forwarded-For")).toBe(false);
  });

  it("does not read the request for a service call", async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({ "X-Forwarded-For": "203.0.113.7" })
    );
    const header = new Headers({ Authorization: "Bearer service-token" });

    await run(resolve, header, serviceCallContextValues());

    expect(resolve).not.toHaveBeenCalled();
    expect(header.has("X-Forwarded-For")).toBe(false);
  });

  it.each(["X-Forwarded-For", "Forwarded"])(
    "keeps the headers a call site set itself when it set %s",
    async (name) => {
      const resolve = vi.fn(() =>
        Promise.resolve({
          Forwarded: "for=203.0.113.7",
          "X-Forwarded-For": "203.0.113.7",
        })
      );
      const header = new Headers({
        Authorization: "Bearer session",
        [name]: "198.51.100.4",
      });

      await run(resolve, header);

      expect(resolve).not.toHaveBeenCalled();
      expect([...header.keys()]).toEqual(["authorization", name.toLowerCase()]);
    }
  );

  it("sets nothing when the request carried neither header", async () => {
    const header = new Headers({ Authorization: "Bearer session" });

    await run(() => Promise.resolve({}), header);

    expect(header.has("Forwarded")).toBe(false);
    expect(header.has("X-Forwarded-For")).toBe(false);
  });
});
