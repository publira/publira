import type { ClientSessionOptions } from "node:http2";

/**
 * Options for the one HTTP/2 session a gRPC transport multiplexes every call
 * onto.
 *
 * Node refuses a new stream on a session that holds more than
 * `maxSessionMemory` megabytes, 10 by default, and the request bodies still
 * waiting to be sent count toward it. An episode upload alone can be 256MB,
 * so with the default every call that starts while one is in flight fails
 * with `NGHTTP2_ENHANCE_YOUR_CALM`. Refusing those calls frees none of the
 * memory the upload holds, and the peer is publira's own API, so the session
 * gets the largest limit Node stores: the option lives in an unsigned 32-bit
 * field, where `2 ** 32` wraps to 0 and refuses every stream.
 */
export const grpcSessionOptions: ClientSessionOptions = {
  maxSessionMemory: 2 ** 32 - 1,
};
