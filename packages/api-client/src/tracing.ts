import type { Interceptor } from "@connectrpc/connect";
import { ConnectError } from "@connectrpc/connect";
import type { Attributes, TextMapSetter } from "@opentelemetry/api";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_RPC_GRPC_STATUS_CODE,
  ATTR_RPC_METHOD,
  ATTR_RPC_SERVICE,
  ATTR_RPC_SYSTEM,
  RPC_SYSTEM_VALUE_CONNECT_RPC,
  RPC_SYSTEM_VALUE_GRPC,
} from "@opentelemetry/semantic-conventions/incubating";

import type { TransportType } from "./transport-type.js";

const TRACER_NAME = "@publira/api-client";

const RPC_SYSTEMS: Record<TransportType, string> = {
  connect: RPC_SYSTEM_VALUE_CONNECT_RPC,
  grpc: RPC_SYSTEM_VALUE_GRPC,
};

/**
 * `propagation.inject` writes into a plain object by default; Connect hands
 * interceptors a `Headers`.
 */
const headerSetter: TextMapSetter<Headers> = {
  set: (headers, key, value) => headers.set(key, value),
};

/**
 * The span name for a Connect procedure, dropping the proto package:
 * `publira.admin.v1.AdminSeriesService` / `ListSeries` becomes
 * `AdminSeriesService/ListSeries`.
 *
 * The package prefix is the same for every RPC a server handles, so it costs
 * width in a trace UI without telling anyone anything; `rpc.service` keeps the
 * qualified name as an attribute. `server/internal/tracing` names the matching
 * server span the same way.
 */
export const rpcSpanName = (
  serviceName: string,
  methodName: string
): string => {
  const unqualified = serviceName.split(".").pop() || serviceName;
  return `${unqualified}/${methodName}`;
};

const serverAttributes = (url: string): Attributes => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {};
  }
  if (!parsed.port) {
    return { [ATTR_SERVER_ADDRESS]: parsed.hostname };
  }
  return {
    [ATTR_SERVER_ADDRESS]: parsed.hostname,
    [ATTR_SERVER_PORT]: Number(parsed.port),
  };
};

/**
 * Returns the interceptor that starts a client span for every outbound RPC and
 * writes the W3C trace context into the request headers.
 *
 * The Go servers trust that `traceparent` as the parent of their own span
 * (`tracing.ConnectHandlerOption`), so an SSR render, the RPC it issues, and
 * the DB queries behind it form one trace. Without a registered
 * TracerProvider every call below records into OpenTelemetry's no-op
 * implementation and no header is written, so the interceptor is safe to
 * install unconditionally.
 */
export const createTracingInterceptor =
  (transport: TransportType): Interceptor =>
  (next) =>
  async (req) => {
    const span = trace
      .getTracer(TRACER_NAME)
      .startSpan(rpcSpanName(req.service.typeName, req.method.name), {
        attributes: {
          [ATTR_RPC_SYSTEM]: RPC_SYSTEMS[transport],
          [ATTR_RPC_SERVICE]: req.service.typeName,
          [ATTR_RPC_METHOD]: req.method.name,
          ...serverAttributes(req.url),
        },
        kind: SpanKind.CLIENT,
      });
    const spanContext = trace.setSpan(context.active(), span);
    propagation.inject(spanContext, req.header, headerSetter);

    try {
      return await context.with(spanContext, () => next(req));
    } catch (error) {
      const connectError = ConnectError.from(error);
      if (transport === "grpc") {
        span.setAttribute(ATTR_RPC_GRPC_STATUS_CODE, connectError.code);
      }
      span.recordException(connectError);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: connectError.message,
      });
      throw error;
    } finally {
      span.end();
    }
  };
