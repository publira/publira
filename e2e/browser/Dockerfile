# The browser that renders the screenshot baseline.
#
# Two screenshots of one screen compare only when the same font files, the same
# FreeType, and the same Chromium rasterized them, so the browser a baseline
# comes out of is pinned here instead of being whatever the machine taking it
# happens to have. `e2e/playwright.config.ts` points only the screenshot
# projects at it; every other project keeps using the Playwright Chromium
# installed on the host.
#
# The version has to match `@playwright/test` in `e2e/package.json` exactly:
# `browserType.connect()` refuses a server built from a different release.
FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

# The font stacks the apps ship end in the Noto CJK faces a Linux desktop
# carries, and the base image has none of them, so text would fall through to
# whatever fontconfig calls `serif` and `sans-serif` — a different face on
# every distribution. Installing them is what makes a stack resolve to the same
# face on the machine that took the baseline and on the runner comparing
# against it.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# `run-server` is a command of the `playwright` CLI, and the image ships the
# browsers without the package that drives them. Installing it at build time
# rather than letting `npx` fetch it when the container starts keeps the server
# off the network and out of the reach of a release published between two runs.
RUN npm install --global --no-fund --no-audit playwright@1.62.1

# A connected client opens its own contexts; the server itself only has to be
# reachable. Port and host come from the compose command.
ENTRYPOINT ["playwright", "run-server"]
