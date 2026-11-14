# The poor-network client: headless browsers inside a container whose link can be shaped
# with "docker compose exec netclient tc qdisc replace dev eth0 root netem ...".
# Keep PLAYWRIGHT_VERSION equal to the @playwright/test version in e2e/package.json:
# a client connects with chromium.connect("ws://127.0.0.1:3100") only when both match.
ARG PLAYWRIGHT_VERSION=1.65.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION

RUN apt-get update \
 && apt-get install -y --no-install-recommends iproute2 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
RUN npm init -y > /dev/null \
 && npm install --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}"

EXPOSE 3100
CMD ["npx", "playwright", "run-server", "--port", "3100", "--host", "0.0.0.0"]
