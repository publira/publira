import { execFileSync } from "node:child_process";
import path from "node:path";

const scriptPath = path.join(import.meta.dirname, "../scripts/api-server.sh");

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
// `/bin/bash` rather than `/usr/bin/bash`: only the former exists on macOS.
const bashBin = process.env.BASH_BIN?.trim() || "/bin/bash";

const runApiServerScript = (action: "start-wait" | "stop"): void => {
  execFileSync(bashBin, [scriptPath, action], { stdio: "inherit" });
};

/**
 * Take the public API down so web-host has to render its backend-unavailable
 * path. Always pair with {@link startApiServer} in an `afterAll`.
 */
export const stopApiServer = (): void => {
  runApiServerScript("stop");
};

/** Restart the public API and block until `/readyz` reports ok again. */
export const startApiServer = (): void => {
  runApiServerScript("start-wait");
};
