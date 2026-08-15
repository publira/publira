import "temporal-polyfill/global";
import { createEmailRendererServer, parsePort } from "./server.ts";

const server = createEmailRendererServer();
const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async (): Promise<void> => {
  try {
    await server[Symbol.asyncDispose]();
  } catch (error) {
    console.error("email-renderer shutdown failed", error);
    process.exitCode = 1;
  }
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen({ host, port });
