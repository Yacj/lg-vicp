#!/usr/bin/env bash
# ============================================================
# 蓝格 VICP 后端一键部署脚本（在服务器上执行）
#
# 首次部署：在空目录中运行并提供仓库地址
#   bash deploy/deploy.sh https://example.com/lg-vicp/backend.git
#   （也可先把脚本放到服务器空目录：bash deploy.sh <仓库地址>）
#
# 更新部署：在已克隆的仓库目录中运行
#   bash deploy/deploy.sh
#
# 支持 monorepo：仓库根含 backend/ 子目录时，从 backend/ 或仓库根运行均可；
# 脚本自动向上查找 git 仓库根执行 pull，并在 backend/ 下执行后续步骤。
#
# 运行时（.env 中 DEPLOY_RUNTIME，默认 docker）：
#   docker：compose 构建并启动 postgres/redis/minio/api/worker/nginx
#   pm2   ：compose 只跑基础设施 + 8080 网关，api/worker 由宿主机 PM2 托管
#
# 脚本会：检查依赖 -> 获取/更新代码 -> 初始化 .env（仅首次）
#   -> 校验必填配置 -> 按运行时构建启动 -> 健康检查
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"

# 定位应用根目录（含 docker-compose.yml 的目录，支持从 deploy/ 目录内或仓库根目录运行）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
  APP_ROOT="$SCRIPT_DIR"
elif [[ -f "$SCRIPT_DIR/../docker-compose.yml" ]]; then
  APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  APP_ROOT="$(pwd)"
fi

COMPOSE_PM2_FILE="$APP_ROOT/deploy/docker-compose.pm2.yml"
ECOSYSTEM_FILE="$APP_ROOT/deploy/ecosystem.config.cjs"

info()  { printf "\033[1;32m[部署]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[警告]\033[0m %s\n" "$*"; }
fail()  { printf "\033[1;31m[失败]\033[0m %s\n" "$*" >&2; exit 1; }

# ---------- 1. 依赖检查 ----------
for cmd in docker git openssl curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "缺少依赖命令：$cmd，请先安装"
done
docker compose version >/dev/null 2>&1 || fail "docker compose 插件不可用，请安装 Docker Compose v2"

# ---------- 2. 获取或更新代码 ----------
# git 仓库根可能高于应用根（monorepo：backend 是仓库子目录），向上查找
GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$GIT_ROOT" ]]; then
  [[ -n "$REPO_URL" ]] || fail "当前目录不是 git 仓库，请提供仓库地址：bash deploy/deploy.sh <仓库地址>"
  [[ -z "$(ls -A "$APP_ROOT")" ]] || fail "目录 $APP_ROOT 不为空，无法克隆代码，请换到空目录执行"
  info "首次部署，克隆代码..."
  git clone "$REPO_URL" "$APP_ROOT"
  GIT_ROOT="$(git -C "$APP_ROOT" rev-parse --show-toplevel)"
  # monorepo 仓库：clone 后应用根在 backend 子目录
  if [[ ! -f "$APP_ROOT/docker-compose.yml" && -f "$GIT_ROOT/backend/docker-compose.yml" ]]; then
    APP_ROOT="$GIT_ROOT/backend"
    COMPOSE_PM2_FILE="$APP_ROOT/deploy/docker-compose.pm2.yml"
    ECOSYSTEM_FILE="$APP_ROOT/deploy/ecosystem.config.cjs"
  fi
else
  info "更新代码（git pull --ff-only）..."
  git -C "$GIT_ROOT" pull --ff-only 2>/dev/null || warn "代码更新失败，继续使用本地代码部署（请确认本地没有冲突改动）"
fi

cd "$APP_ROOT"

# ---------- 3. .env 初始化（仅首次） ----------
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || fail "缺少 .env.example，请确认代码完整"
  cp .env.example .env
  info "已从 .env.example 生成 .env，正在生成随机密钥..."

  set_key() { # 用法：set_key <键名> <随机字节数 hex 长度>
    local key="$1" len="$2"
    local value
    value="$(openssl rand -hex "$len")"
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  }
  set_key JWT_SECRET 32
  set_key AI_CONFIG_ENCRYPTION_KEY 16   # 32 个十六进制字符 = 32 字节
  set_key POSTGRES_PASSWORD 16
  set_key STORAGE_ACCESS_KEY 16
  set_key STORAGE_SECRET_KEY 16

  # PM2 / 宿主机进程读取 DATABASE_URL；hex 密码不含 URL 特殊字符
  POSTGRES_PWD_NEW="$(sed -n 's|^POSTGRES_PASSWORD=||p' .env | tail -n 1)"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${POSTGRES_PWD_NEW}@localhost:5432/lg_vicp_backend|" .env

  info "请打开 $(pwd)/.env 修改以下两项后重新运行本脚本："
  info "  BOOTSTRAP_ADMIN_PASSWORD：管理员登录密码（至少 5 位）"
  info "  DEPLOY_RUNTIME：docker（默认，全容器）或 pm2（宿主机 Node + PM2）"
  exit 0
fi

# ---------- 4. 必填配置校验 ----------
read_env() { sed -n "s|^$1=||p" .env | tail -n 1; }

JWT_SECRET="$(read_env JWT_SECRET)"
AI_KEY="$(read_env AI_CONFIG_ENCRYPTION_KEY)"
BOOTSTRAP_PWD="$(read_env BOOTSTRAP_ADMIN_PASSWORD)"
POSTGRES_PWD="$(read_env POSTGRES_PASSWORD)"
DEPLOY_RUNTIME="$(read_env DEPLOY_RUNTIME)"
DEPLOY_RUNTIME="${DEPLOY_RUNTIME:-docker}"

[[ "$DEPLOY_RUNTIME" == "docker" || "$DEPLOY_RUNTIME" == "pm2" ]] \
  || fail ".env 中 DEPLOY_RUNTIME 只能是 docker 或 pm2，当前为：$DEPLOY_RUNTIME"
[[ -n "$JWT_SECRET" && "$JWT_SECRET" != "change-this-jwt-secret-before-use-123456" ]] \
  || fail ".env 中 JWT_SECRET 未设置或仍为示例值，请修改后重试"
[[ -n "$AI_KEY" && "${#AI_KEY}" -eq 32 ]] \
  || fail ".env 中 AI_CONFIG_ENCRYPTION_KEY 必须恰好 32 字节（如 32 位十六进制字符）"
[[ -n "$BOOTSTRAP_PWD" && "$BOOTSTRAP_PWD" != "请替换为至少5位的管理员密码" && "${#BOOTSTRAP_PWD}" -ge 5 ]] \
  || fail ".env 中 BOOTSTRAP_ADMIN_PASSWORD 未设置或少于 5 位，请修改后重试"
if [[ "$POSTGRES_PWD" == "postgres" ]]; then
  warn "POSTGRES_PASSWORD 仍为默认值 postgres，公网服务器请务必修改"
fi

print_success() {
  local bootstrap_user
  bootstrap_user="$(read_env BOOTSTRAP_ADMIN_USERNAME)"
  [[ -n "$bootstrap_user" ]] || bootstrap_user="admin"
  cat <<EOF

  访问地址：http://<服务器IP>:8080
  管理账号：$bootstrap_user（密码见 .env 的 BOOTSTRAP_ADMIN_PASSWORD）
  运行时：$DEPLOY_RUNTIME

  注意：修改管理员密码请在登录后台后使用「用户管理 -> 重置密码」，
  不要直接修改 .env 的 BOOTSTRAP_ADMIN_PASSWORD（该值仅在首次初始化时生效）。
EOF
}

wait_healthy() {
  info "等待服务就绪（最多 120 秒）..."
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:8080/health/ready" >/dev/null 2>&1; then
      info "部署完成，服务已就绪。"
      print_success
      exit 0
    fi
    sleep 2
  done
}

# ---------- 5. 按运行时构建并启动 ----------
if [[ "$DEPLOY_RUNTIME" == "pm2" ]]; then
  info "使用 PM2 运行时部署 api/worker（基础设施仍走 Docker）..."

  for cmd in node npm; do
    command -v "$cmd" >/dev/null 2>&1 || fail "PM2 部署缺少命令：$cmd，请先安装 Node.js 22+"
  done
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  [[ "$NODE_MAJOR" -ge 22 ]] || fail "PM2 部署需要 Node.js 22+，当前：$(node -v)"
  [[ -f "$ECOSYSTEM_FILE" ]] || fail "缺少 $ECOSYSTEM_FILE"
  [[ -f "$COMPOSE_PM2_FILE" ]] || fail "缺少 $COMPOSE_PM2_FILE"

  if ! command -v pnpm >/dev/null 2>&1; then
    info "启用 corepack 安装 pnpm..."
    command -v corepack >/dev/null 2>&1 || fail "缺少 corepack，请安装 Node.js 22+（自带 corepack）"
    corepack enable
    corepack prepare pnpm@11.17.0 --activate
  fi
  command -v pnpm >/dev/null 2>&1 || fail "pnpm 不可用"

  if ! command -v pm2 >/dev/null 2>&1; then
    info "安装 PM2（npm i -g pm2）..."
    npm install -g pm2
  fi

  DATABASE_URL="$(read_env DATABASE_URL)"
  if [[ "$DATABASE_URL" == *"@localhost:"* || "$DATABASE_URL" == *"@127.0.0.1:"* ]]; then
    if [[ "$DATABASE_URL" != *":${POSTGRES_PWD}@"* ]]; then
      info "按 POSTGRES_PASSWORD 同步本机 DATABASE_URL..."
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${POSTGRES_PWD}@localhost:5432/lg_vicp_backend|" .env
    fi
  else
    warn "DATABASE_URL 未指向 localhost，请确认宿主机进程能连上 PostgreSQL"
  fi

  CHROMIUM_PATH="$(read_env PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)"
  if [[ -z "$CHROMIUM_PATH" ]]; then
    warn "未配置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH，报告 PDF 导出可能失败。Debian/Ubuntu 可执行：apt-get install -y chromium fonts-noto-cjk"
  elif [[ ! -x "$CHROMIUM_PATH" ]]; then
    warn "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$CHROMIUM_PATH 不可执行，报告 PDF 导出可能失败"
  fi

  info "停止可能存在的 Docker api/worker/nginx，避免与 PM2 双开抢队列..."
  docker compose stop api worker nginx >/dev/null 2>&1 || true

  info "启动 postgres / redis / minio 并等待健康检查通过..."
  if ! docker compose -f docker-compose.yml -f "$COMPOSE_PM2_FILE" up -d --wait --wait-timeout 60 postgres redis minio; then
    fail "基础设施未能启动或未通过健康检查，请执行 docker compose logs postgres redis minio 查看日志"
  fi

  info "安装依赖并构建（pnpm install + pnpm build）..."
  pnpm install --frozen-lockfile --prod=false
  pnpm build

  info "执行数据库迁移（node dist/db/migrate.js）..."
  if ! node dist/db/migrate.js; then
    fail "数据库迁移失败，请检查 PostgreSQL 连接、drizzle/ 迁移文件与数据库状态"
  fi

  info "执行数据初始化（seed 幂等，已存在用户不会被覆盖）..."
  if ! node dist/db/seed.js; then
    warn "seed 失败，若库已初始化可忽略；首次部署失败请查看上方日志"
  fi

  mkdir -p logs
  info "启动/重载 PM2 进程（lg-vicp-api / lg-vicp-worker）..."
  pm2 startOrReload "$ECOSYSTEM_FILE" --update-env
  pm2 save >/dev/null 2>&1 || true
  if [[ "$(id -u)" -eq 0 ]]; then
    pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || warn "未写入 systemd 开机自启，可手动执行：pm2 startup && pm2 save"
    pm2 save >/dev/null 2>&1 || true
  else
    warn "当前非 root，开机自启请手动执行：pm2 startup && 按提示用 sudo 执行生成的命令，然后 pm2 save"
  fi

  info "启动 8080 网关（Nginx -> 宿主机 :3000）..."
  docker compose -f docker-compose.yml -f "$COMPOSE_PM2_FILE" up -d gateway

  wait_healthy
  warn "健康检查超时，最近日志如下："
  pm2 logs --lines 80 --nostream || true
  docker compose -f docker-compose.yml -f "$COMPOSE_PM2_FILE" logs --tail 40 gateway || true
  fail "服务未在 120 秒内就绪，请根据上方日志排查（pm2 logs / docker compose logs -f）"
fi

# docker 运行时：若曾用 PM2，先停掉以免双 Worker 抢队列
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe lg-vicp-api >/dev/null 2>&1 || pm2 describe lg-vicp-worker >/dev/null 2>&1; then
    info "检测到 PM2 进程，正在删除以免与 Docker api/worker 双开..."
    pm2 delete lg-vicp-api lg-vicp-worker >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi
fi
info "停止可能存在的 PM2 网关容器，避免与 compose nginx 抢 8080..."
docker compose -f docker-compose.yml -f "$COMPOSE_PM2_FILE" stop gateway >/dev/null 2>&1 || true

info "构建镜像并启动服务（首次构建需拉取依赖，可能需要数分钟）..."
docker compose build api worker

# 迁移先行：先启动 postgres 并等待健康，再执行迁移，失败立即中止，
# 避免 api 容器反复重启后才暴露问题。迁移容器不使用 --no-deps，
# 由 Compose 按 depends_on 加入同一服务网络并确保依赖已就绪，避免无法解析 postgres。
info "启动 postgres 并等待健康检查通过..."
if ! docker compose up -d --wait --wait-timeout 60 postgres; then
  fail "postgres 未能启动或未通过健康检查，请执行 docker compose logs postgres 查看日志"
fi

info "执行数据库迁移（node dist/db/migrate.js）..."
if ! docker compose run --rm api node dist/db/migrate.js; then
  fail "数据库迁移失败，请检查 PostgreSQL 连接、drizzle/ 迁移文件与数据库状态"
fi

# ---------- 6. 启动服务 ----------
info "启动服务（api 容器内迁移幂等跳过）..."
docker compose up -d

# ---------- 7. 健康检查 ----------
wait_healthy
warn "健康检查超时，最近日志如下："
docker compose logs --tail 100 api || true
fail "服务未在 120 秒内就绪，请根据上方日志排查（docker compose logs -f 跟踪）"
