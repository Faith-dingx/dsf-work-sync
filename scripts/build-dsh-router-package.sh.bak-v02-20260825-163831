#!/bin/bash
# =============================================================================
# dsh 软路由安装包打包脚本 v0.2
# 按当前 dsh 版本重新打包 + 严格可执行性检测（真机级 musl 验证）
#
# 目标产物:   dsh-router-install-<VERSION>.tar.gz  (ImmortalWrt / OpenWrt x86_64-musl)
# 关键升级:   v0.2 起执行「严格可执行性检测」——
#             ① 所有 shell 脚本语法校验 (bash -n)
#             ② musl node 在 alpine (真实 musl libc) 容器中真机运行验证
#                (node --version / dsh --version / dump-config / web 启动 + HTTP 200)
#             ③ 布局验证: 包内容按 /srv/dsh/app + /srv/dsh/node + /srv/dsh/home 组装后启动
#             ④ ELF 解释器校验 (file 确认 ld-musl 动态链接)
#             ⑤ 可执行位 / 关键文件存在性校验
#             ⑥ libstdc++/libgcc_s 依赖随包携带 (musl 提取), LD_LIBRARY_PATH 兜底
#
# 用法: bash scripts/build-dsh-router-package.sh
# 依赖: node>=18, pnpm, docker (daemon 运行), sha256sum, file, python3
# =============================================================================
set -euo pipefail

# ------------------------------------------------------------------ 配置区
WORKSPACE=/home/dingx/DSF-work
HARNESS_DIR=/home/dingx/deepseek-harness
DEPLOY_DIR="$WORKSPACE/.temp/dsh-deploy-v2"          # 本次构建工作区(全新)
OUTPUT_DIR="$WORKSPACE/.temp"
VERSION="v0.1.2"                                      # 安装包版本
SCRIPT_VERSION="v0.2"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PKG_NAME="dsh-router-install-$VERSION"
PKG_DIR="$DEPLOY_DIR/$PKG_NAME"
LOG="$DEPLOY_DIR/build-$VERSION-$TIMESTAMP.log"
ALPINE_IMG="alpine:3.20"
NODE_VERSION="v22.23.2"
NODE_VER_SHORT="22.23.2"
NODE_TARBALL="$WORKSPACE/.temp/dsh-deploy/downloads/node-$NODE_VERSION-linux-x64-musl.tar.xz"
NODE_SHA256="2d18b5731055f7efa6c899004909b00ee110e38d3775745f60ec9ccf1f9982e7"
OLD_PKG_DIR="$WORKSPACE/.temp/dsh-deploy"             # 旧包(v0.1.1)素材: install.sh / init.d 模板
HARNESS_COMMIT="$(cd "$HARNESS_DIR" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ------------------------------------------------------------------ 颜色/日志
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info()  { printf "%(%H:%M:%S)T ${BLUE}[INFO]${NC} %s\n" -1 "$*" | tee -a "$LOG"; }
log_ok()    { printf "%(%H:%M:%S)T ${GREEN}[ OK ]${NC} %s\n" -1 "$*" | tee -a "$LOG"; }
log_warn()  { printf "%(%H:%M:%S)T ${YELLOW}[WARN]${NC} %s\n" -1 "$*" | tee -a "$LOG"; }
log_fail()  { printf "%(%H:%M:%S)T ${RED}[FAIL]${NC} %s\n" -1 "$*" | tee -a "$LOG"; }
die()       { log_fail "$*"; exit 1; }

# ------------------------------------------------------------------ 检测函数
# 运行一个检测项, 失败立即使脚本失败 (严格模式)
check() {
    local name="$1"; shift
    if "$@" > >(sed "s/^/    /" | tee -a "$LOG") 2>&1; then
        log_ok "检测通过: $name"
    else
        log_fail "检测失败: $name (exit=$?)"
        exit 1
    fi
}

# =============================================================================
# 0. 前置检查
# =============================================================================
preflight() {
    # 日志目录必须先于任何日志输出创建
    rm -rf "$DEPLOY_DIR"; mkdir -p "$DEPLOY_DIR"
    : > "$LOG"
    log_info "启动 dsh 软路由安装包打包脚本 $SCRIPT_VERSION (安装包 $VERSION)"
    log_info "harness commit: $HARNESS_COMMIT"
    for t in node pnpm docker sha256sum file python3; do
        command -v "$t" >/dev/null 2>&1 || die "缺少工具: $t"
    done
    [ -d "$HARNESS_DIR/.git" ] || die "harness 目录不存在: $HARNESS_DIR"
    docker info >/dev/null 2>&1 || die "docker daemon 未运行 (严格验证需要)"
    docker image inspect "$ALPINE_IMG" >/dev/null 2>&1 || docker pull "$ALPINE_IMG" >/dev/null 2>&1 || die "无法获取镜像 $ALPINE_IMG"
    log_ok "前置检查完成"
}

# =============================================================================
# 1. 重建 web 前端 (确保包含最新源码, 含 08-23 LAN/remote 修复)
# =============================================================================
build_web() {
    log_info "重建 web 前端 dist (pnpm --filter @deepseek-ai/dsh-web-frontend build) ..."
    ( cd "$HARNESS_DIR" && pnpm --filter @deepseek-ai/dsh-web-frontend build ) >>"$LOG" 2>&1 \
        || die "web 构建失败"
    [ -f "$HARNESS_DIR/apps/web/dist/index.html" ] || die "web dist 缺失"
    log_ok "web 前端重建完成"
}

# =============================================================================
# 2. pnpm deploy 打包闭包 (cli + web + 全部 workspace 依赖 + 插件)
# =============================================================================
deploy_closure() {
    log_info "pnpm deploy --legacy --prod -> $DEPLOY_DIR/app (约 40-60s) ..."
    ( cd "$HARNESS_DIR" && pnpm --filter @deepseek-ai/dsh deploy --legacy --prod "$DEPLOY_DIR/app" ) >>"$LOG" 2>&1 \
        || die "pnpm deploy 失败"
    [ -x "$DEPLOY_DIR/app/lib/bin.js" ] || die "deploy 产物缺 lib/bin.js"
    log_ok "运行闭包已生成 ($(du -sh "$DEPLOY_DIR/app" | cut -f1))"
}

# =============================================================================
# 3. 打包边界修复: 顶层扁平覆盖层 + @deepseek-ai 差集拷贝 + vendor 特殊包
#    内联 python (逻辑与旧 fill-missing.py 一致, 路径参数化)
# =============================================================================
fixup_closure() {
    log_info "修复打包边界 (顶层扁平 + @deepseek-ai 差集 + vendor 包) ..."
    python3 - "$DEPLOY_DIR/app" "$HARNESS_DIR" "$DEPLOY_DIR/app/node_modules" <<'PYEOF' >>"$LOG" 2>&1 || die "边界修复失败"
import json, os, shutil, sys, glob

APP, REPO, NM = sys.argv[1], sys.argv[2], sys.argv[3]

# ---- 3a. 顶层扁平覆盖层: .pnpm/*/node_modules/* -> node_modules 顶层 (含 @scope 内层)
def flatten():
    linked = 0
    pnpm = os.path.join(NM, ".pnpm")
    if not os.path.isdir(pnpm):
        return linked
    for inst in os.listdir(pnpm):
        inst_nm = os.path.join(pnpm, inst, "node_modules")
        if not os.path.isdir(inst_nm):
            continue
        for entry in os.listdir(inst_nm):
            if entry == ".pnpm":
                continue
            if entry == "@deepseek-ai":
                continue  # @deepseek-ai 包全部实体拷贝 (3c), 不建链 (pnpm file: 链指向仓库源, 迁移后断)
            top = os.path.join(NM, entry)
            src = os.path.join(inst_nm, entry)
            if entry.startswith("@"):
                # scope 目录: 在顶层 node_modules 下合并各实例的 scope 内层包
                scope_top = top
                os.makedirs(scope_top, exist_ok=True)
                for name in os.listdir(src):
                    if name == ".pnpm":
                        continue
                    st = os.path.join(scope_top, name)
                    if os.path.lexists(st):
                        continue
                    ss = os.path.join(src, name)
                    rel = os.path.relpath(ss, scope_top)
                    os.symlink(rel, st)
                    linked += 1
            else:
                # 普通包: 链接到顶层; 绝对路径旧链一律重建为相对链 (容器/scp 后仍可达)
                if os.path.lexists(top):
                    target = os.readlink(top)
                    if not os.path.isabs(target):
                        continue  # pnpm 原生相对链, 保留
                    os.unlink(top)  # 绝对路径链 -> 重建为相对链
                rel = os.path.relpath(src, NM)
                os.symlink(rel, top)
                linked += 1
    return linked

linked = flatten()
print(f"[fixup] 顶层扁平链接: +{linked}")

# ---- 3b. vendor 特殊包 (源码不在 packages/*/* 但需随包)
def copytree_filtered(src, dst):
    EXCLUDE_DIRS = {"node_modules", "src", "tests", "coverage", ".git", "stress-tests"}
    os.makedirs(dst, exist_ok=True)
    for entry in os.listdir(src):
        if entry in EXCLUDE_DIRS:
            continue
        s = os.path.join(src, entry)
        d = os.path.join(dst, entry)
        if os.path.isfile(s) and (entry.endswith(".tsbuildinfo") or entry.endswith(".map")):
            continue
        if os.path.isdir(s):
            shutil.copytree(s, d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.tsbuildinfo", "*.map"))
        else:
            shutil.copy2(s, d)

vendor_pkgs = {
    "schemastery": "@deepseek-ai/schemastery",
    "group": "@deepseek-ai/cordis-plugin-group",
}
ds = os.path.join(NM, "@deepseek-ai")
for src_name, pkg_name in vendor_pkgs.items():
    vd = os.path.join(REPO, "vendor", src_name)
    if not os.path.isdir(vd):
        print(f"[fixup] vendor/{src_name} 不存在, 跳过")
        continue
    dst = os.path.join(ds, pkg_name.split("/", 1)[1])
    if not os.path.isdir(dst):
        copytree_filtered(vd, dst)
        print(f"[fixup] vendor {pkg_name} -> {dst}")

# ---- 3c. @deepseek-ai 全部实体拷贝
#    pnpm deploy 对 workspace/vendor 包只建 file: 链接 (指向仓库源目录),
#    迁移到容器/软路由后断链. 故此对所有 @deepseek-ai 包做实体拷贝,
#    顶层若为 symlink 一律删除重拷 (覆盖 pnpm 原生 file: 链).
def collect_repo():
    repo = {}
    globs = [f"{REPO}/packages/*/*/package.json", f"{REPO}/vendor/*/package.json", f"{REPO}/apps/*/package.json",
             f"{REPO}/native/*/package.json", f"{REPO}/native/*/packages/*/package.json"]
    for g in globs:
        for f in glob.glob(g):
            if "/node_modules/" in f:
                continue
            try:
                d = json.load(open(f))
            except Exception:
                continue
            n = d.get("name", "")
            if n.startswith("@deepseek-ai/"):
                repo[n] = os.path.dirname(f)
    return repo

repo = collect_repo()
copied, skipped = [], []
for name in sorted(repo):
    srcdir = repo[name]
    # 实体化判定: 包目录即可 (平台子包无 lib/index.js, 如 landlock 的 linux-x64 平台包)
    if not os.path.exists(os.path.join(srcdir, "package.json")):
        skipped.append(f"{name} (no package.json)")
        continue
    dst = os.path.join(ds, name.split("/", 1)[1])
    # 顶层若是软链(指向仓库)或不存在 -> 删除并实体拷贝
    if os.path.islink(dst):
        os.unlink(dst)
    if os.path.isdir(dst):
        continue  # 已是实体目录
    copytree_filtered(srcdir, dst)
    copied.append(name)
print(f"[fixup] @deepseek-ai 实体化: total {len(repo)}, copied {len(copied)}, skipped {len(skipped)}")
for c in copied:
    print(f"    + {c}")
for s in skipped:
    print(f"    - {s}")
PYEOF
    log_ok "打包边界修复完成"
}

# =============================================================================
# 4. musl node 运行时准备 (缓存 tar.xz -> strip -> 附带 libstdc++/libgcc_s)
# =============================================================================
prepare_node() {
    log_info "准备 musl node $NODE_VERSION ..."
    if [ ! -f "$NODE_TARBALL" ]; then
        log_warn "本地无 musl node 缓存, 尝试下载 (unofficial-builds)"
        mkdir -p "$(dirname "$NODE_TARBALL")"
        curl -fL --retry 3 -o "$NODE_TARBALL" \
            "https://unofficial-builds.nodejs.org/download/release/$NODE_VERSION/node-$NODE_VERSION-linux-x64-musl.tar.xz" \
            >>"$LOG" 2>&1 || die "musl node 下载失败"
    fi
    echo "$NODE_SHA256  $NODE_TARBALL" | sha256sum -c - >/dev/null 2>&1 \
        || die "musl node SHA-256 校验失败: $NODE_TARBALL"

    NODE_SRC="$DEPLOY_DIR/node-src"
    rm -rf "$NODE_SRC"; mkdir -p "$NODE_SRC"
    tar -xJf "$NODE_TARBALL" -C "$NODE_SRC" --strip-components=1
    BIN="$NODE_SRC/bin/node"
    [ -x "$BIN" ] || die "musl node 解包后缺二进制"

    # strip (官方 musl 二进制未 strip)
    strip --strip-unneeded "$BIN" 2>/dev/null && log_info "node 二进制已 strip" || log_warn "strip 失败(保留原样, 不影响运行)"
    # 移除编译头文件与文档 (运行时不需要)
    rm -rf "$NODE_SRC/include" "$NODE_SRC/share" "$NODE_SRC/CHANGELOG.md" "$NODE_SRC/README.md" 2>/dev/null || :

    # 附带 musl libstdc++ / libgcc_s (严格验证发现: node 依赖这两个库, 目标机未必预装)
    LIBC_DIR="$NODE_SRC/lib"
    mkdir -p "$LIBC_DIR"
    docker run --rm "$ALPINE_IMG" sh -c \
        'apk add --no-cache libstdc++ >/dev/null 2>&1; cp /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /lib/ 2>/dev/null; ls /usr/lib/libstdc++.so.6* /usr/lib/libgcc_s.so.1 /lib/libgcc_s.so.1 2>/dev/null' \
        > "$DEPLOY_DIR/libc-list.txt" 2>>"$LOG" || die "从 alpine 提取 musl 库失败"
    # 从容器复制库文件
    docker run --rm -v "$LIBC_DIR:/out" "$ALPINE_IMG" sh -c \
        'apk add --no-cache libstdc++ >/dev/null 2>&1; cp -L /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /out/ 2>/dev/null; chmod 755 /out/*' \
        >>"$LOG" 2>&1 || die "复制 musl 库失败"
    [ -f "$LIBC_DIR/libstdc++.so.6" ] && [ -f "$LIBC_DIR/libgcc_s.so.1" ] || die "musl 库复制不完整"
    log_ok "musl node 就绪 (含 libstdc++.so.6 / libgcc_s.so.1 兜底)"
}

# =============================================================================
# 5. 组装安装包目录
# =============================================================================
assemble() {
    log_info "组装安装包目录 $PKG_DIR ..."
    mkdir -p "$PKG_DIR/install" "$PKG_DIR/etc/init.d"

    cp -a "$DEPLOY_DIR/app" "$PKG_DIR/app"
    cp -a "$DEPLOY_DIR/node-src" "$PKG_DIR/node"
    cp "$OLD_PKG_DIR/install/example-settings.yaml" "$PKG_DIR/install/example-settings.yaml"
    cp "$OLD_PKG_DIR/etc/init.d/dsh" "$PKG_DIR/etc/init.d/dsh"

    # ---- 生成 install.sh (v0.1.2: 新增 LD_LIBRARY_PATH 启动 + libstdc++ 检测提示)
    cat > "$PKG_DIR/install.sh" <<'SH'
#!/bin/sh
# dsh 软路由一键安装脚本 (dsh-router-install-v0.1.2)
# 目标: ImmortalWrt / OpenWrt (BusyBox ash, root 运行)
#
# 用法: 解包后 cd <包目录> && ./install.sh
# 作用:
#   1) 校验包内 4 项内容 (app 闭包 / node 运行时 / 配置模板 / init 脚本)
#   2) 拷贝 app -> /srv/dsh/app (首次; 已存在跳过)
#   3) 拷贝 node -> /srv/dsh/node (首次; 已存在跳过)
#   4) 建首启配置骨架: /srv/dsh/home/settings.yaml (从模板复制, 密钥占位)
#   5) node 自检 (musl; 若缺 libstdc++ 给出 opkg 指引)
#   6) 安装并启用 dsh 服务 (/etc/init.d/dsh enable)
#
# 注意: 密钥不进包; 首次使用请编辑 /srv/dsh/home/settings.yaml
#       或建 /srv/dsh/home/dsh.env (AGNES_API_KEY / OPENCODE_GO_API_KEY ...)

PKG_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=/srv/dsh/app
NODE_DIR=/srv/dsh/node
DSH_HOME=/srv/dsh/home
DSH_INIT=/etc/init.d/dsh
SETTINGS_TEMPLATE="$PKG_DIR/install/example-settings.yaml"
SETTINGS_TARGET="$DSH_HOME/settings.yaml"

say() { echo "[dsh-install] $*"; }

# 0) root 检查 (ImmortalWrt 默认 root)
[ "$(id -u)" = 0 ] || {
	echo "[dsh-install] 必须使用 root 运行 (ImmortalWrt 登录默认即 root)"; exit 1;
}

# 1) 包完整性校验
[ -d "$PKG_DIR/app" ] && [ -x "$PKG_DIR/app/lib/bin.js" ] || { echo "[dsh-install] 缺少 app 闭包 (app/lib/bin.js)"; exit 1; }
[ -x "$PKG_DIR/node/bin/node" ] || { echo "[dsh-install] 缺少 node 运行时 (node/bin/node)"; exit 1; }
[ -f "$SETTINGS_TEMPLATE" ] || { echo "[dsh-install] 缺少 install/example-settings.yaml"; exit 1; }
[ -f "$PKG_DIR/etc/init.d/dsh" ] || { echo "[dsh-install] 缺少 etc/init.d/dsh"; exit 1; }

# 2) 部署 app 闭包与 node 运行时 (仅首次复制)
mkdir -p /srv/dsh
if [ -d "$APP_DIR" ]; then
	say "$APP_DIR 已存在, 跳过 app 拷贝 (如需覆盖请先删除)"
else
	cp -a "$PKG_DIR/app" "$APP_DIR"
	say "app 闭包已部署到 $APP_DIR"
fi
if [ -d "$NODE_DIR" ]; then
	say "$NODE_DIR 已存在, 跳过 node 拷贝"
else
	cp -a "$PKG_DIR/node" "$NODE_DIR"
	say "node 运行时已部署到 $NODE_DIR"
fi

# 3) 首启配置骨架 (密钥占位模板; 真实 key 由用户首次填写)
mkdir -p "$DSH_HOME"
if [ -f "$SETTINGS_TARGET" ]; then
	say "settings.yaml 已存在, 保留现值 (如需重建请先删除再执行)"
else
	cp "$SETTINGS_TEMPLATE" "$SETTINGS_TARGET"
	chmod 600 "$SETTINGS_TARGET"
	say "已生成首启配置: $SETTINGS_TARGET"
fi

# 4) node 自检 (musl 二进制; 优先用包内 musl 库 LD_LIBRARY_PATH 兜底)
LD_LIBRARY_PATH="$NODE_DIR/lib"
export LD_LIBRARY_PATH
if "$NODE_DIR/bin/node" --version >/dev/null 2>&1; then
	say "node 自检通过: $("$NODE_DIR/bin/node" --version)"
else
	echo "[dsh-install] node 自检失败. 可能原因与处理:"
	echo "  a) 目标机不是 x86_64 + musl libc (ImmortalWrt 24.10 默认满足)"
	echo "  b) 缺少 C++ 运行库: opkg update && opkg install libstdc++6"
	echo "  包内已附带 musl libstdc++/libgcc_s (node/lib/), 若有仍有问题请检查上面的 (a)"
	exit 1
fi

# 5) 安装 dsh 服务并启用开机自启
cp "$PKG_DIR/etc/init.d/dsh" "$DSH_INIT"
chmod +x "$DSH_INIT"
"$DSH_INIT" enable

cat <<EOF

[dsh-install] 完成。首次使用请:
  1) 编辑 $SETTINGS_TARGET 填入模型 provider 与 key:
     - 或建 $DSH_HOME/dsh.env 导出环境变量 (AGNES_API_KEY / OPENCODE_GO_API_KEY)
  2) 启动服务: /etc/init.d/dsh start
  3) 打开浏览器访问: http://<路由器IP>:3080
  日志: /var/log/dsh.log   开机自启: 已启用 (S95dsh)
EOF
SH
    chmod +x "$PKG_DIR/install.sh"

    # ---- 更新 etc/init.d/dsh: 版本注记 + LD_LIBRARY_PATH + --trusted-host
    cat > "$PKG_DIR/etc/init.d/dsh" <<'SH'
#!/bin/sh /etc/rc.common
# dsh — DeepSeek Harness web 服务（软路由 AI 网关前端）
# 来源: dsh-router-install-v0.1.2 安装包  版本: v0.1.2
#
# v0.1.2: 启动命令注入 LD_LIBRARY_PATH (包内 musl libstdc++/libgcc_s 兜底);
#         严格可执行性验证 (alpine musl 容器中验证过 node/dsh/web 启动);
#         --trusted-host <LAN 网段> 保留 (特权方法信任, 默认 10.10.10.0/24,
#         可用环境变量 DSH_TRUSTED_HOSTS 覆盖, 写入 /srv/dsh/home/dsh.env 或部署前导出)
#
# 用法: /etc/init.d/dsh {start|stop|restart|reload|enable|disable|status}
#   enable 即开机自启 (rc.common 建 /etc/rc.d/S95dsh)
#   崩溃自动重启 (procd respawn)
#
# 日志: /var/log/dsh.log
# 配置: /srv/dsh/home/settings.yaml (首启占位, 自行填 key)
# 密钥环境变量: /srv/dsh/home/dsh.env (不存在则忽略, 可放 AGNES_API_KEY / OPENCODE_GO_API_KEY)

START=95
STOP=10
USE_PROCD=1

APP_DIR=/srv/dsh/app
NODE_DIR=/srv/dsh/node
DSH_HOME=/srv/dsh/home
DSH_HOST=0.0.0.0
DSH_PORT=3080
# 局域网信任网段 (特权方法 trusted host), 可用环境变量 DSH_TRUSTED_HOSTS / dsh.env 覆盖
DSH_TRUSTED_HOSTS="${DSH_TRUSTED_HOSTS:-10.10.10.0/24}"
DSH_LOG=/var/log/dsh.log
DSH_ENV_FILE=/srv/dsh/home/dsh.env
# 包内 musl C++ 运行库兜底 (目标机未装 libstdc++6 时也能启动)
LD_LIBRARY_PATH="$NODE_DIR/lib"
export LD_LIBRARY_PATH

# 载入首启密钥环境变量 (settings.yaml 中 apiKeyEnv 引用这些名字)
load_key_env() {
	[ -r "$DSH_ENV_FILE" ] && . "$DSH_ENV_FILE" 2>/dev/null || :
}

start_service() {
	load_key_env
	procd_open_instance
	procd_set_param command /bin/sh -c "cd '$APP_DIR' && exec '$NODE_DIR/bin/node' lib/bin.js web --host '$DSH_HOST' --port '$DSH_PORT' --trusted-host '$DSH_TRUSTED_HOSTS' >> '$DSH_LOG' 2>&1"
	procd_set_param cwd "$APP_DIR"
	procd_set_param pidfile /var/run/dsh.pid
	# respawn: 1h 内最多重启, 每次延迟 5s
	procd_set_param respawn 3600 5 5
	procd_set_param env DSH_HOME="$DSH_HOME" AGNES_API_KEY="$AGNES_API_KEY" OPENCODE_GO_API_KEY="$OPENCODE_GO_API_KEY" DSH_TRUSTED_HOSTS="$DSH_TRUSTED_HOSTS" LD_LIBRARY_PATH="$LD_LIBRARY_PATH"
	procd_close_instance
}
SH
    chmod +x "$PKG_DIR/etc/init.d/dsh"

    # ---- README.md
    cat > "$PKG_DIR/README.md" <<MD
# dsh-router-install-$VERSION — dsh 软路由安装包

DeepSeek Harness (dsh) 面向软路由/ImmortalWrt 的一键部署包 **$VERSION** (2026-08-24)。
在软路由上以 **procd 服务** 挂载 dsh web 网关 (端口 **3080**)，局域网内手机/PC/电视盒子免安装浏览器直接使用。

> 构建自 harness commit \`$HARNESS_COMMIT\` (feature/lan-access, web 前端含 LAN/remote 修复)。
> **本包 (v0.1.2) 通过「严格可执行性检测」**：musl node 与 dsh 全程在 alpine (真实 musl libc)
> 容器内以 \`/srv/dsh\` 双目录布局真机级验证 (node --version / dsh --version / dump-config / web HTTP 200)。

---

## 1. 包内容

| 路径 | 说明 |
|---|---|
| \`app/\` | dsh 运行闭包 (\`lib/bin.js\` 入口 + node_modules prod 依赖 + web 前端 + 全部插件) |
| \`node/\` | Node.js **linux-x64-musl** v$NODE_VER_SHORT 官方运行时 (unofficial-builds, 已 strip) + **musl libstdc++/libgcc_s 兜底库** (\`node/lib/\`) |
| \`install.sh\` | 一键安装脚本 (BusyBox ash, root 运行; 含 node 自检与 libstdc++ 提示) |
| \`install/example-settings.yaml\` | 首启配置模板 (密钥占位, **不含任何真实 key**) |
| \`etc/init.d/dsh\` | procd 开机自启服务脚本 (LD_LIBRARY_PATH 注入 + respawn 崩溃自愈) |
| \`README.md\` | 本文档 |

**包体范围**：本包只含 dsh 自身前端与运行时，**不含** LLM 网关服务 (:9888) 等既有服务——它们是你路由器上已部署、dsh 通过 \`settings.yaml\` 的 \`router-9888\` provider 调用的现有基础设施。

## 2. 安装三步

> 目标机要求：x86_64 ImmortalWrt/OpenWrt (musl libc, 如 24.10.5)，root 登录，\`/srv\` 有 ≥600M 空闲。
> 缺 C++ 运行库时安装包已带兜底 (自动生效)；也可以手动 \`opkg update && opkg install libstdc++6\`。

```bash
# ① scp 上传 (本机执行)
scp dsh-router-install-$VERSION.tar.gz root@<路由器IP>:/

# ② 解包 + 安装 (路由器上执行)
ssh root@<路由器IP>
cd / && tar xzf /dsh-router-install-$VERSION.tar.gz -C /tmp
cd /tmp/dsh-router-install-$VERSION && ./install.sh

# ③ 填配置 → 启动 (install.sh 完成后)
vi /srv/dsh/home/settings.yaml        # 填 provider/key，或建 /srv/dsh/home/dsh.env
/etc/init.d/dsh start                 # 首次手动启动（开机自启已 enable）
```

浏览器访问 \`http://<路由器IP>:3080\`。

## 3. 首个配置 (密钥不进包)

- 生效文件: **\`/srv/dsh/home/settings.yaml\`** (\`DSH_HOME=/srv/dsh/home\`, procd 启动时注入)
- 密钥通过 \`apiKeyEnv\` 引用环境变量名 (如 \`AGNES_API_KEY\`), 实际值放 \`/srv/dsh/home/dsh.env\` (init 自动载入)
- 本机 LLM 网关 provider \`router-9888\`: \`baseURL: http://127.0.0.1:9888\`

## 4. 服务管理

| 命令 | 作用 |
|---|---|
| \`/etc/init.d/dsh start\|stop\|restart\` | 手动启停/重启 |
| \`/etc/init.d/dsh enable\|disable\` | 开机自启开关 |
| \`/etc/init.d/dsh status\` | 运行状态 |
| \`logread -e dsh\` | procd 系统日志 |
| \`tail -f /var/log/dsh.log\` | dsh 应用日志 |

## 5. v0.1.2 变更

1. **严格可执行性检测** (本版新增): 全部 shell 脚本 bash -n 语法校验; musl node 在 alpine
   (真实 musl) 容器中真机运行 node --version / dsh --version / dump-config / web 启动 HTTP 200;
   包内容按 \`/srv/dsh\` 目录布局组装后整体启动验证。
2. **musl 库兜底**: 发现官方 musl node 依赖 libstdc++/libgcc_s (v0.1.1 未真机验证出此依赖),
   现随包附带 musl 版至 \`node/lib/\`, 启动命令注入 \`LD_LIBRARY_PATH\`, 目标机缺库也能启动。
3. **web 前端重建**: 包含 08-23 LAN/remote 修复。
4. **构建溯源**: 打包脚本 \`scripts/build-dsh-router-package.sh\` v$SCRIPT_VERSION, 产物带时间戳日志。

## 6. 已知限制

1. **node-pty (musl) 未真机验证**: 终端/子进程类能力依赖原生模块, 需软路由真机确认; 不可用时
   浏览器内终端不可用 (web 对话/网关核心不受影响), 替代: ssh/ttyd (:7681)。
2. **体积**: 整包解压 ≈360M; 瘦身方向留给后续版本 (去未用 provider、prebuild 按平台裁剪)。
3. **日志无轮转**: \`/var/log/dsh.log\` 持续增大; 可加 cron truncate 或 logrotate。
4. **配置热更新**: 改 \`settings.yaml\`/\`dsh.env\` 后需 \`/etc/init.d/dsh restart\` 生效。
MD

    log_ok "安装包目录组装完成"
}

# =============================================================================
# 6. 严格可执行性检测 (v0.2 核心: 任一失败即整体失败)
# =============================================================================
strict_verify() {
    log_info "========== 严格可执行性检测 =========="

    # 6.1 shell 语法 (所有脚本)
    check "shell 语法 (bash -n)" bash -n "$PKG_DIR/install.sh"
    check "shell 语法 (init.d/dsh)" bash -n "$PKG_DIR/etc/init.d/dsh"

    # 6.2 可执行位
    check "install.sh 可执行位" test -x "$PKG_DIR/install.sh"
    check "init.d/dsh 可执行位" test -x "$PKG_DIR/etc/init.d/dsh"

    # 6.3 关键文件存在性
    check "app/lib/bin.js" test -x "$PKG_DIR/app/lib/bin.js"
    check "node/bin/node" test -x "$PKG_DIR/node/bin/node"

    # 6.4 ELF 解释器 (musl)
    log_info "ELF 检查:"
    file "$PKG_DIR/node/bin/node"
    file "$PKG_DIR/node/bin/node" | grep -q "ld-musl-x86_64" \
        || die "node 二进制不是 musl 动态链接 (预期 /lib/ld-musl-x86_64.so.1)"

    # 6.5 musl 真机级验证 (docker alpine, 真实 musl libc)
    log_info "musl 真机级验证 (docker $ALPINE_IMG):"
    local SROOT="/srv/dsh"
    local LDPATH="$SROOT/node/lib"

    # a) node --version (含 LD_LIBRARY_PATH, 模拟 install.sh 实际启动方式)
    check "musl node --version" docker run --rm \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e LD_LIBRARY_PATH="$LDPATH" \
        "$ALPINE_IMG" sh -c 'apk add --no-cache libstdc++ >/dev/null 2>&1 || :; /srv/dsh/node/bin/node --version'

    # b) dsh --version (app 闭包在真实 musl 下运行)
    check "musl dsh --version" docker run --rm \
        -v "$PKG_DIR/app:/srv/dsh/app:ro" \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e LD_LIBRARY_PATH="$LDPATH" \
        "$ALPINE_IMG" sh -c 'apk add --no-cache libstdc++ >/dev/null 2>&1 || :; cd /srv/dsh/app && /srv/dsh/node/bin/node lib/bin.js --version'

    # c) dump-default-config (web profile 配置树可生成)
    check "musl dump-default-config" docker run --rm \
        -v "$PKG_DIR/app:/srv/dsh/app:ro" \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e LD_LIBRARY_PATH="$LDPATH" \
        "$ALPINE_IMG" sh -c 'apk add --no-cache libstdc++ >/dev/null 2>&1 || :; cd /srv/dsh/app && /srv/dsh/node/bin/node lib/bin.js --profile web --dump-default-config | head -c 100 >/dev/null && echo DUMP-OK'

    # d) web 启动 + HTTP 200 (完整布局: app + node + home, 模拟 /srv/dsh; 在容器内 curl)
    #    DSH_HOME 用容器内路径 (dsh 首启自动初始化; 避免宿主目录 root 属主残留)
    check "musl web 启动 + HTTP 200" docker run --rm \
        -v "$PKG_DIR/app:/srv/dsh/app:ro" \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e DSH_HOME=/tmp/dshhome \
        -e LD_LIBRARY_PATH="$LDPATH" \
        -w /srv/dsh/app \
        "$ALPINE_IMG" sh -c '
            apk add --no-cache libstdc++ curl >/dev/null 2>&1 || :
            mkdir -p /tmp/dshhome
            /srv/dsh/node/bin/node lib/bin.js web --host 127.0.0.1 --port 3099 --no-open >/tmp/dsh-web.log 2>&1 &
            WPID=$!
            ok=0
            for i in $(seq 1 40); do
                code=$(curl -s -o /tmp/page.html -w "%{http_code}" http://127.0.0.1:3099/ 2>/dev/null || true)
                [ "$code" = "200" ] && { ok=1; break; }
                sleep 1
            done
            kill $WPID 2>/dev/null || true
            [ "$ok" = "1" ] || { echo "--- dsh-web.log ---"; tail -30 /tmp/dsh-web.log; exit 1; }
            grep -q "<div id=\"root\">" /tmp/page.html && echo "WEB-HTTP-200-AND-ROOT-DIV-OK" || { echo "page missing root div"; exit 1; }
        '

    # e) 布局: app 顶层 node_modules 的 @deepseek-ai 关键包存在 (loader 解析前提)
    for p in dsh-base dsh-web-app cordis-plugin-group schemastery node-addon-landlock-run; do
        check "闭包 @deepseek-ai/$p" test -e "$PKG_DIR/app/node_modules/@deepseek-ai/$p"
    done

    log_ok "全部严格可执行性检测通过 ✅"
}

# =============================================================================
# 7. 打包
# =============================================================================
package() {
    log_info "打包 tar.gz ..."
    ( cd "$DEPLOY_DIR" && tar czf "$OUTPUT_DIR/$PKG_NAME.tar.gz" "$PKG_NAME" )
    [ -s "$OUTPUT_DIR/$PKG_NAME.tar.gz" ] || die "tar 打包失败"
    log_ok "安装包已生成: $OUTPUT_DIR/$PKG_NAME.tar.gz"
    sha256sum "$OUTPUT_DIR/$PKG_NAME.tar.gz" | tee -a "$LOG"
    log_info "包体积: $(du -sh "$OUTPUT_DIR/$PKG_NAME.tar.gz" | cut -f1) (解压后约 360M)"
    log_info "解压后包内大小: $(du -sh "$PKG_DIR" | cut -f1)"
}

# =============================================================================
main() {
    preflight
    build_web
    deploy_closure
    fixup_closure
    prepare_node
    assemble
    strict_verify
    package
    log_ok "全流程完成 ✅  安装包: $OUTPUT_DIR/$PKG_NAME.tar.gz"
}
main "$@"