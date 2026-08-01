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
# 脚本自动向上查找 git 仓库根执行 pull，并在 backend/ 下执行 docker compose。
#
# 脚本会：检查依赖 -> 获取/更新代码 -> 初始化 .env（仅首次）
#   -> 校验必填配置 -> docker compose 构建启动 -> 健康检查
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

  info "请打开 $(pwd)/.env 修改以下两项后重新运行本脚本："
  info "  BOOTSTRAP_ADMIN_PASSWORD：管理员登录密码（至少 12 位）"
  info "  CORS_ORIGIN：前端访问地址（如 https://admin.example.com）"
  exit 0
fi

# ---------- 4. 必填配置校验 ----------
read_env() { sed -n "s|^$1=||p" .env | tail -n 1; }

JWT_SECRET="$(read_env JWT_SECRET)"
AI_KEY="$(read_env AI_CONFIG_ENCRYPTION_KEY)"
BOOTSTRAP_PWD="$(read_env BOOTSTRAP_ADMIN_PASSWORD)"
POSTGRES_PWD="$(read_env POSTGRES_PASSWORD)"

[[ -n "$JWT_SECRET" && "$JWT_SECRET" != "change-this-jwt-secret-before-use-123456" ]] \
  || fail ".env 中 JWT_SECRET 未设置或仍为示例值，请修改后重试"
[[ -n "$AI_KEY" && "${#AI_KEY}" -eq 32 ]] \
  || fail ".env 中 AI_CONFIG_ENCRYPTION_KEY 必须恰好 32 字节（如 32 位十六进制字符）"
[[ -n "$BOOTSTRAP_PWD" && "$BOOTSTRAP_PWD" != "请替换为至少12位的管理员密码" && "${#BOOTSTRAP_PWD}" -ge 12 ]] \
  || fail ".env 中 BOOTSTRAP_ADMIN_PASSWORD 未设置或少于 12 位，请修改后重试"
if [[ "$POSTGRES_PWD" == "postgres" ]]; then
  warn "POSTGRES_PASSWORD 仍为默认值 postgres，公网服务器请务必修改"
fi

# ---------- 5. 构建并启动 ----------
info "构建镜像并启动服务（首次构建需拉取依赖，可能需要数分钟）..."
docker compose up --build -d

# ---------- 6. 健康检查 ----------
info "等待服务就绪（最多 120 秒）..."
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8080/health/ready" >/dev/null 2>&1; then
    info "部署完成，服务已就绪。"
    BOOTSTRAP_USER="$(read_env BOOTSTRAP_ADMIN_USERNAME)"
    [[ -n "$BOOTSTRAP_USER" ]] || BOOTSTRAP_USER="admin"
    cat <<EOF

  访问地址：http://<服务器IP>:8080
  管理账号：$BOOTSTRAP_USER（密码见 .env 的 BOOTSTRAP_ADMIN_PASSWORD）

  注意：修改管理员密码请在登录后台后使用「用户管理 -> 重置密码」，
  不要直接修改 .env 的 BOOTSTRAP_ADMIN_PASSWORD（该值仅在首次初始化时生效）。
EOF
    exit 0
  fi
  sleep 2
done

warn "健康检查超时，最近日志如下："
docker compose logs --tail 100 api || true
fail "服务未在 120 秒内就绪，请根据上方日志排查（docker compose logs -f 跟踪）"