import { createServer } from "node:http";

import { connectNodeAdapter } from "@connectrpc/connect-node";

import { emailRendererRoutes } from "./routes.js";

const livezHeaders = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
} as const;

const readyzHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

export const createEmailRendererServer = () =>
  createServer(
    connectNodeAdapter({
      fallback: (request, response) => {
        if (request.method !== "GET") {
          response.writeHead(404);
          response.end();
          return;
        }

        const pathname = request.url?.split("?", 1)[0];
        if (pathname === "/livez") {
          response.writeHead(200, livezHeaders);
          response.end("ok");
          return;
        }
        if (pathname === "/readyz") {
          response.writeHead(200, readyzHeaders);
          response.end('{"status":"ok","checks":{}}\n');
          return;
        }

        response.writeHead(404);
        response.end();
      },
      routes: emailRendererRoutes,
    })
  );

export const parsePort = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "") {
    return 8080;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
};
