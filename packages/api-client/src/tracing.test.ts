import type {
  Interceptor,
  UnaryRequest,
  UnaryResponse,
} from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import type { TextMapPropagator } from "@opentelemetry/api";
import { propagation } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTracingInterceptor, rpcSpanName } from "./tracing.js";

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

/**
 * Stands in for W3CTraceContextPropagator: the interceptor has to reach the
 * carrier through the setter, because Connect hands it a `Headers` rather than
 * the plain object the default setter writes to.
 */
const stubPropagator: TextMapPropagator = {
  extract: (context) => context,
  fields: () => ["traceparent"],
  inject: (_context, carrier, setter) => {
    setter.set(carrier, "traceparent", TRACEPARENT);
  },
};

const request = (): UnaryRequest =>
  ({
    header: new Headers(),
    method: { name: "ListSeries" },
    service: { typeName: "publira.admin.v1.AdminSeriesService" },
    stream: false,
    url: "http://127.0.0.1:8001/publira.admin.v1.AdminSeriesService/ListSeries",
  }) as unknown as UnaryRequest;

const invoke = async (
  interceptor: Interceptor,
  next: Parameters<Interceptor>[0]
) => {
  const req = request();
  const response = await interceptor(next)(req);
  return { req, response };
};

afterEach(() => {
  propagation.disable();
});

describe("rpcSpanName", () => {
  it("drops the proto package", () => {
    expect(
      rpcSpanName("publira.admin.v1.AdminSeriesService", "ListSeries")
    ).toBe("AdminSeriesService/ListSeries");
  });

  it("keeps a service name that has no package", () => {
    expect(rpcSpanName("AdminSeriesService", "ListSeries")).toBe(
      "AdminSeriesService/ListSeries"
    );
  });
});

describe("createTracingInterceptor", () => {
  it("writes the trace context into the request headers", async () => {
    propagation.setGlobalPropagator(stubPropagator);
    const next = vi.fn(() => Promise.resolve({} as UnaryResponse));

    const { req } = await invoke(createTracingInterceptor("grpc"), next);

    expect(req.header.get("traceparent")).toBe(TRACEPARENT);
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves the headers alone when no propagator is registered", async () => {
    const next = vi.fn(() => Promise.resolve({} as UnaryResponse));

    const { req } = await invoke(createTracingInterceptor("grpc"), next);

    expect(req.header.get("traceparent")).toBeNull();
  });

  it("rethrows the original error", async () => {
    propagation.setGlobalPropagator(stubPropagator);
    const failure = new ConnectError("gone", Code.NotFound);
    const next = vi.fn(() => Promise.reject(failure));

    await expect(invoke(createTracingInterceptor("grpc"), next)).rejects.toBe(
      failure
    );
  });
});
