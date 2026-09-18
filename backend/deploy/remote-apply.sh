#!/usr/bin/env bash
# ============================================================
# 蓝格 VICP 后端：服务器端落地（由本地 pnpm deploy 上传后调用）
#
# 不走 git。假定当前目录已解压本次发布包（dist / drizzle / package.json 等）。
# 绝不覆盖已有 .env，绝不执行 schema push / drop / reset。
# 迁移失败则回滚 dist 并中止，不重载 PM2。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_ROOT"

info()  { printf "\033[1;32m[部署]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[警告]\033[0m %s\n" "$*"; }
fail()  { printf "\033[1;31m[失败]\033[0m %s\n" "$*" >&2; exit 1; }

read_env() { sed -n "s|^$1=||p" .env | tail -n 1; }

restore_dist() {
  if [[ -d .bak/dist ]]; then
    warn "正在回滚 dist 到解压前版本..."
    rm -rf dist
    cp -a .bak/dist dist
  fi
}

# 小内存机编译 argon2 时优先用 3.8+
if [[ -x /usr/bin/python3.8 ]]; then
  export PYTHON=/usr/bin/python3.8
  export npm_config_python=/usr/bin/python3.8
elif [[ -x /usr/bin/python3.9 ]]; then
  export PYTHON=/usr/bin/python3.9
  export npm_config_python=/usr/bin/python3.9
fi

[[ -f dist/server.js ]] || fail "缺少 dist/server.js，发布包不完整"
[[ -f dist/worker.js ]] || fail "缺少 dist/worker.js，发布包不完整"
[[ -f dist/db/migrate.js ]] || fail "缺少 dist/db/migrate.js，无法执行数据库迁移"
[[ -d drizzle ]] || fail "缺少 drizzle/ 迁移目录"
[[ -f package.json && -f pnpm-lock.yaml ]] || fail "缺少 package.json 或 pnpm-lock.yaml"

# ---------- .env：只初始化一次，已有文件永不覆盖 ----------
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || fail "缺少 .env.example，无法生成服务器配置"
  cp .env.example .env
  info "首次部署，已从 .env.example 生成 .env，正在写入随机密钥..."

  set_key() {
    local key="$1" len="$2"
    local value
    value="$(openssl rand -hex "$len")"
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  }
  command -v openssl >/dev/null 2>&1 || fail "缺少 openssl，无法生成随机密钥"
  set_key JWT_SECRET 32
  set_key AI_CONFIG_ENCRYPTION_KEY 16
  set_key POSTGRES_PASSWORD 16
  set_key STORAGE_ACCESS_KEY 16
  set_key STORAGE_SECRET_KEY 16
  POSTGRES_PWD_NEW="$(read_env POSTGRES_PASSWORD)"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://postgres:${POSTGRES_PWD_NEW}@127.0.0.1:5432/lg_vicp_backend|" .env

  cat <<EOF

[部署] 请登录服务器编辑 $(pwd)/.env 后重新执行 pnpm deploy：
  BOOTSTRAP_ADMIN_PASSWORD  管理员登录密码（至少 5 位）
  DATABASE_URL              指向真实 PostgreSQL（勿覆盖已有库）
  REDIS_URL
  存储相关 STORAGE_* / OSS_*

  注意：不要把本地开发 .env 直接拷到生产。
EOF
  exit 10
fi

JWT_SECRET="$(read_env JWT_SECRET)"
AI_KEY="$(read_env AI_CONFIG_ENCRYPTION_KEY)"
BOOTSTRAP_PWD="$(read_env BOOTSTRAP_ADMIN_PASSWORD)"
DATABASE_URL="$(read_env DATABASE_URL)"
[[ -n "$JWT_SECRET" && "$JWT_SECRET" != "change-this-jwt-secret-before-use-123456" ]] \
  || fail ".env 中 JWT_SECRET 未设置或仍为示例值"
[[ -n "$AI_KEY" && "${#AI_KEY}" -eq 32 ]] \
  || fail ".env 中 AI_CONFIG_ENCRYPTION_KEY 必须恰好 32 字节"
[[ -n "$BOOTSTRAP_PWD" && "$BOOTSTRAP_PWD" != "请替换为至少5位的管理员密码" && "${#BOOTSTRAP_PWD}" -ge 5 ]] \
  || fail ".env 中 BOOTSTRAP_ADMIN_PASSWORD 未设置或少于 5 位"
[[ -n "$DATABASE_URL" && "$DATABASE_URL" == postgresql://* ]] \
  || fail ".env 中 DATABASE_URL 无效，必须是 postgresql://..."

# ---------- 运行时依赖 ----------
for cmd in node npm; do
  command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令：$cmd，请安装 Node.js 22+"
done
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[[ "$NODE_MAJOR" -ge 22 ]] || fail "需要 Node.js 22+，当前：$(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  command -v corepack >/dev/null 2>&1 || fail "缺少 corepack，请安装 Node.js 22+"
  corepack enable
  corepack prepare pnpm@11.17.0 --activate
fi
command -v pnpm >/dev/null 2>&1 || fail "pnpm 不可用"

# 宝塔 Node 目录优先，避免起出第二套 PM2 daemon
if [[ -x /www/server/nodejs/v22.22.3/bin/pm2 ]]; then
  export PATH="/www/server/nodejs/v22.22.3/bin:$PATH"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  info "安装 PM2..."
  npm install -g pm2
fi

# ---------- 安装依赖（本机已 tsc，服务器不再 pnpm build） ----------
mkdir -p logs
info "安装生产依赖（pnpm install --frozen-lockfile，不在服务器编译 TypeScript）..."
if ! pnpm install --frozen-lockfile --prod=false; then
  restore_dist
  fail "依赖安装失败，已回滚 dist，PM2 未重载"
fi

find_pg_dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    command -v pg_dump
    return 0
  fi
  local candidate
  for candidate in \
    /www/server/pgsql/bin/pg_dump \
    /usr/pgsql-16/bin/pg_dump \
    /usr/pgsql-15/bin/pg_dump \
    /usr/pgsql-14/bin/pg_dump \
    /usr/bin/pg_dump
  do
    if [[ -x "$candidate" ]]; then
      printf "%s" "$candidate"
      return 0
    fi
  done
  return 1
}

BACKUP_DB="${DEPLOY_BACKUP_DB:-1}"
if [[ "$BACKUP_DB" == "1" ]]; then
  mkdir -p logs/db-backups
  if PG_DUMP_BIN="$(find_pg_dump)"; then
    STAMP="$(date +%Y%m%d%H%M%S)"
    DUMP_FILE="logs/db-backups/pre-migrate-${STAMP}.dump"
    info "迁移前备份数据库 -> $DUMP_FILE"
    if ! "$PG_DUMP_BIN" --dbname="$DATABASE_URL" --no-owner --format=custom --file="$DUMP_FILE"; then
      if [[ "${DEPLOY_BACKUP_DB:-1}" == "require" ]]; then
        restore_dist
        fail "数据库备份失败（DEPLOY_BACKUP_DB=require），已中止并回滚 dist"
      fi
      warn "数据库备份失败，仍继续迁移。请确认 DATABASE_URL 与 pg_dump 可用；设 DEPLOY_BACKUP_DB=require 可改为失败即停"
    fi
    # 只保留最近 5 份
    ls -1t logs/db-backups/pre-migrate-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f || true
  else
    warn "未找到 pg_dump，跳过迁移前备份。建议安装 postgresql 客户端，或把 DEPLOY_BACKUP_DB=0 显式跳过"
  fi
else
  warn "已设置 DEPLOY_BACKUP_DB=0，跳过迁移前备份"
fi

info "执行数据库迁移（仅应用 drizzle/ 新增 migration，不 push、不删库）..."
if ! node dist/db/migrate.js; then
  restore_dist
  fail "数据库迁移失败，PM2 未重载。请检查 PostgreSQL 与 drizzle/ 迁移文件；已写入的 migration 按条事务提交，失败条不会落库"
fi

if [[ "${DEPLOY_RUN_SEED:-}" == "1" || ! -f .deploy-seeded ]]; then
  info "执行 seed（幂等，已存在用户/权限不会覆盖）..."
  if node dist/db/seed.js; then
    touch .deploy-seeded
  else
    warn "seed 失败，若库已初始化可忽略；需要补跑时设置 DEPLOY_RUN_SEED=1"
  fi
else
  info "跳过 seed（已执行过）。需要补权限种子时设置 DEPLOY_RUN_SEED=1"
fi

if pm2 describe dist >/dev/null 2>&1; then
  warn "检测到宝塔遗留进程 dist，删除以免与 lg-vicp-api 抢 3000 端口"
  pm2 delete dist >/dev/null 2>&1 || true
fi

info "启动/重载 PM2（lg-vicp-api / lg-vicp-worker）..."
pm2 startOrReload "$APP_ROOT/deploy/ecosystem.config.cjs" --update-env
pm2 save >/dev/null 2>&1 || true

HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/health/live}"
info "等待健康检查 $HEALTH_URL （最多 60 秒）..."
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    info "部署完成，服务已就绪。"
    pm2 status
    exit 0
  fi
  sleep 2
done

warn "健康检查超时，最近日志："
pm2 logs lg-vicp-api --lines 80 --nostream || true
fail "服务未在 60 秒内就绪，请查看 pm2 logs"
