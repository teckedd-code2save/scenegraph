FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-inter fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY services/render-worker/ services/render-worker/

RUN pnpm install --frozen-lockfile --filter @scenegraph/contracts --filter @scenegraph/render-worker \
  && pnpm --filter @scenegraph/contracts build \
  && pnpm --filter @scenegraph/render-worker build \
  && mkdir -p /data/renders \
  && chown -R node:node /data

WORKDIR /app/services/render-worker
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium

USER node
CMD ["node", "dist/index.js"]
