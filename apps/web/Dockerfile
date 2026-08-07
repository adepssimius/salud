# syntax=docker/dockerfile:1

# `nx build web` defaults to the production configuration; output lands
# in dist/apps/web/browser.

FROM node:22.13.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn nx build web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/apps/web/browser /usr/share/nginx/html
EXPOSE 80
