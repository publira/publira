import { ConnectError } from "@connectrpc/connect";
import type { Interceptor, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { GrpcTransportOptions } from "@connectrpc/connect-node";

/**
 * How long the session may sit without a call before the client closes it.
 *
 * The API closes an idle connection itself after `IdleTimeout` in
 * `server/internal/httpserver`, 120 seconds, by sending a GOAWAY. A call that
 * starts on the session while that GOAWAY is still on the wire is one the API
 * never reads, and it fails as a refused stream. Closing the session at half
 * that leaves the client as the side that ends an idle connection, which it
 * does knowing that no call is starting on it.
 */
export const GRPC_IDLE_CONNECTION_TIMEOUT_MS = 60_000;

/**
 * Whether the API closed the stream of a call before processing it: it sent
 * RST_STREAM with `REFUSED_STREAM`, or a GOAWAY whose last stream precedes the
 * call's. Node reports both with the same stream error, which connect-node
 * keeps as the cause of an `internal` ConnectError.
 */
const isRefusedStream = (error: unknown): boolean => {
  if (!(error instanceof ConnectError)) {
    return false;
  }
  const { cause } = error;
  return (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "ERR_HTTP2_STREAM_ERROR" &&
    cause.message.endsWith(" NGHTTP2_REFUSED_STREAM")
  );
};

/**
 * Sends a unary call once more when the API refused its stream.
 *
 * A refused stream is one the API did not process (RFC 9113, section 8.7), so
 * sending it again is safe for every RPC, mutations included, and gRPC clients
 * retry it the same way: transparently, and once (gRFC A6). The second attempt
 * goes out on a new session, since the refusing one takes no more calls, so it
 * reaches the API after an idle GOAWAY or a restart, and fails the way any
 * call does while the API is down. A streaming call is left alone: a request
 * stream it has started to consume cannot be sent again.
 */
export const retryRefusedStream: Interceptor = (next) => async (req) => {
  if (req.stream) {
    return next(req);
  }
  try {
    return await next(req);
  } catch (error) {
    if (!isRefusedStream(error) || req.signal.aborted) {
      throw error;
    }
    return next(req);
  }
};

/**
 * The gRPC transport the Next.js apps reach the API with, which multiplexes
 * every call onto one HTTP/2 session.
 *
 * Node refuses a new stream on a session that holds more than
 * `maxSessionMemory` megabytes, 10 by default, and the request bodies still
 * waiting to be sent count toward it. An episode upload alone can be 256MB,
 * so with the default every call that starts while one is in flight fails
 * with `NGHTTP2_ENHANCE_YOUR_CALM`. Refusing those calls frees none of the
 * memory the upload holds, and the peer is publira's own API, so the session
 * gets the largest limit Node stores: the option lives in an unsigned 32-bit
 * field, where `2 ** 32` wraps to 0 and refuses every stream.
 *
 * {@link retryRefusedStream} runs inside every other interceptor, so they see
 * one call whichever attempt answered it.
 */
export const createApiGrpcTransport = (
  options: GrpcTransportOptions
): Transport =>
  createGrpcTransport({
    ...options,
    idleConnectionTimeoutMs: GRPC_IDLE_CONNECTION_TIMEOUT_MS,
    interceptors: [...(options.interceptors ?? []), retryRefusedStream],
    nodeOptions: { maxSessionMemory: 2 ** 32 - 1 },
  });
