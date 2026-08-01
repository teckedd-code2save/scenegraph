FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node apps/studio/ ./

ENV NODE_ENV=production
ENV STUDIO_PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.mjs"]
