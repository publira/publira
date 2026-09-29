import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Absolute path avoids PATH lookup (oxlint sonarjs/no-os-command-from-path).
const bashBin = (): string =>
  process.env.PUBLIRA_BASH_BIN?.trim() || "/usr/bin/bash";

const uploadScript = fileURLToPath(
  new URL("../scripts/upload-episode-pages.sh", import.meta.url)
);

/**
 * Put a body-image fixture at every object key the episode's rows name.
 *
 * `task e2e:db` does this for the episode every run needs. A suite that seeds
 * an episode of its own applies its scenario file first and calls this
 * afterwards, so the tenant it creates is not in the catalogue the screenshot
 * projects photograph.
 */
export const uploadEpisodePages = (episodePublicId: string): void => {
  if (!/^[A-Za-z0-9]+$/u.test(episodePublicId)) {
    throw new Error(`invalid episode public id: ${episodePublicId}`);
  }

  execFileSync(bashBin(), [uploadScript, episodePublicId], {
    stdio: "inherit",
  });
};
