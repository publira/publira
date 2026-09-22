import { execFileSync } from "node:child_process";
import path from "node:path";

const scriptPath = path.join(import.meta.dirname, "../scripts/server.sh");

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
// `/bin/bash` rather than `/usr/bin/bash`: only the former exists on macOS.
const bashBin = process.env.PUBLIRA_BASH_BIN?.trim() || "/bin/bash";

const runServerScript = (action: "start-wait" | "stop"): void => {
  execFileSync(bashBin, [scriptPath, action], { stdio: "inherit" });
};

/**
 * Take the backend down so an app has to render its backend-unavailable path.
 * One process serves all three Connect namespaces and the images, so this
 * stops the tenant site, the tenant console, and the platform console
 * together — the specs that call it therefore run in a chain rather than
 * beside each other (see `playwright.config.ts`). Always pair with
 * {@link startServer} in an `afterAll`.
 */
export const stopServer = (): void => {
  runServerScript("stop");
};

/** Restart the server and block until `/readyz` reports ok again. */
export const startServer = (): void => {
  runServerScript("start-wait");
};
