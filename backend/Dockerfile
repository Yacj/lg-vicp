FROM node:22.23.2-bookworm-slim AS build
WORKDIR /app
RUN corepack enable \
  && corepack prepare pnpm@11.17.0 --activate \
  && pnpm config set registry https://registry.npmmirror.com \
  && pnpm config set fetch-retries 5 \
  && pnpm config set fetch-timeout 120000 \
  && pnpm config set network-concurrency 8
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json drizzle.config.ts ./
COPY scripts ./scripts
COPY src ./src
# 小内存机器上 tsc 默认堆会涨到 ~1.5G，触发 OOM killer；构建期单独限制
RUN NODE_OPTIONS=--max-old-space-size=640 pnpm build

FROM node:22.23.2-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
# 放在 COPY --from=build 之后，避免 BuildKit 与 tsc 并行安装 Chromium 撑爆内存
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.17.0 --activate
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
