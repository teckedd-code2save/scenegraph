FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY services/director/ services/director/

RUN pnpm install --frozen-lockfile --filter @scenegraph/contracts --filter @scenegraph/director \
  && pnpm --filter @scenegraph/contracts build \
  && pnpm --filter @scenegraph/director build \
  && mkdir -p /data/projects /data/renders \
  && chown -R node:node /data

WORKDIR /app/services/director
ENV NODE_ENV=production
ENV DIRECTOR_PORT=4100
EXPOSE 4100

USER node
CMD ["node", "dist/index.js"]
