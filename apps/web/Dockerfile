# syntax=docker/dockerfile:1

# `nx build web` defaults to the production configuration; output lands
# in dist/apps/web/browser.

FROM node:22.13.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn nx build web

# The static bundle, flattened so its layout is identical whether it came from `build` above or
# from outside. CI passes `--build-context dist=dist/apps/web/browser` (the artifact the `build`
# job already produced), which substitutes this stage wholesale and prunes the compile above out
# of the graph entirely. A plain `docker build .` with no extra flags still builds from source.
FROM scratch AS dist
COPY --from=build /workspace/dist/apps/web/browser/ /

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=dist / /usr/share/nginx/html
EXPOSE 80
