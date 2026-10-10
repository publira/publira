import "temporal-polyfill/global";
import { once } from "node:events";

import { createEmailRendererServer, parsePort } from "./server.ts";

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";

const serveUntilSignal = async (): Promise<void> => {
  const signalled = Promise.race([
    once(process, "SIGINT"),
    once(process, "SIGTERM"),
  ]);
  await using server = createEmailRendererServer();
  server.listen({ host, port });
  await signalled;
};

try {
  await serveUntilSignal();
} catch (error) {
  console.error("email-renderer shutdown failed", error);
  process.exitCode = 1;
}
