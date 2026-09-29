/**
 * Wire protocol a client talks to the Go servers with. `grpc` is the internal
 * Next.js → API path (HTTP/2); `connect` is the browser-compatible default.
 */
export type TransportType = "connect" | "grpc";
