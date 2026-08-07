# syntax=docker/dockerfile:1

# Builds the api Nx project (dist/api), which itself gets an auto-generated,
# pruned package.json + yarn.lock via NxAppWebpackPlugin's generatePackageJson.

FROM node:22.13.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn nx build api

# better-sqlite3 / argon2 are native modules; keep compiler toolchain isolated
# to this throwaway stage so the runtime image stays slim.
FROM node:22.13.0-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /workspace/dist/api/package.json /workspace/dist/api/yarn.lock ./
RUN yarn install --production --frozen-lockfile

FROM node:22.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /workspace/dist/api/main.js* ./
COPY --from=build /workspace/dist/api/assets ./assets
COPY --from=prod-deps /app/node_modules ./node_modules
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "main.js"]
