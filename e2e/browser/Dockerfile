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
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

# The font stacks the apps ship end in the Noto CJK faces a Linux desktop
# carries, and the base image has none of them, so text would fall through to
# whatever fontconfig calls `serif` and `sans-serif` — a different face on
# every distribution. Installing them is what makes a stack resolve to the same
# face on the machine that took the baseline and on the runner comparing
# against it.
#
# Which is only true while the face is the same one, so the version is pinned
# and the source is the `noble` release pocket alone. That pocket is frozen at
# release: the index and the pool files it names never change afterwards, so
# the pin resolves to the same bytes on every rebuild without a snapshot
# service in between. `noble-updates` is deliberately absent, since it does
# move and would give the pin a second place to resolve from. Moving the
# version means retaking every baseline in the same commit.
RUN printf '%s\n' \
      'Types: deb' \
      'URIs: http://archive.ubuntu.com/ubuntu' \
      'Suites: noble' \
      'Components: main universe' \
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update \
  && apt-get install --yes --no-install-recommends \
      fonts-noto-cjk=1:20230817+repack1-3 \
  && rm -rf /var/lib/apt/lists/*

# `run-server` is a command of the `playwright` CLI, and the image ships the
# browsers without the package that drives them. Installing it at build time
# rather than letting `npx` fetch it when the container starts keeps the server
# off the network and out of the reach of a release published between two runs.
RUN npm install --global --no-fund --no-audit playwright@1.63.0

# A connected client opens its own contexts; the server itself only has to be
# reachable. Port and host come from the compose command.
ENTRYPOINT ["playwright", "run-server"]
