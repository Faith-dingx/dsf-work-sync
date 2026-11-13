#!/bin/bash
# =============================================================================
# dsh 软路由安装包打包脚本 v0.3
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
#   v0.3 起修复软路由 (ImmortalWrt/musl) 三个「启动即崩」问题 (v0.1.4 安装包)——
#             A) 注入 musl 版 sharp 原生模块 (linuxmusl-x64), 修复 attachment 加载崩溃
#             B) init 启动命令带 --expose-internals, 修复 HMR 服务构造崩溃
#             C) --trusted-host 默认值改单 IP 自动探测, 修复 CIDR 网段非法崩溃
#             另: install.sh 安装后做真实启动自检 (curl 探活 + 日志关键字)
#
# 用法: bash scripts/build-dsh-router-package.sh
# 依赖: node>=18, pnpm, docker (daemon 运行), sha256sum, file, python3
# =============================================================================
set -euo pipefail

# ------------------------------------------------------------------ 配置区
WORKSPACE="${WORKSPACE:-/home/dingx/DSF-work}"
HARNESS_DIR="${HARNESS_DIR:-/home/dingx/dsh}"
DEPLOY_DIR="$WORKSPACE/.temp/dsh-deploy-v2"          # 本次构建工作区(全新, 仅此目录允许 rm -rf)
OUTPUT_DIR="$WORKSPACE/.temp"
VERSION="v0.1.4"                                      # 安装包版本 (v0.1.3 → v0.1.4: 修复 musl 三启动崩溃)
SCRIPT_VERSION="v0.3"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BUILD_DATE="$(date +%Y-%m-%d)"
PKG_NAME="dsh-router-install-$VERSION"
PKG_DIR="$DEPLOY_DIR/$PKG_NAME"
LOG="$DEPLOY_DIR/build-$VERSION-$TIMESTAMP.log"
MANIFEST="$PKG_DIR/MANIFEST.txt"                      # 产物 MANIFEST (含 harness commit / 素材来源)
ALPINE_IMG="alpine:3.20"
NODE_VERSION="v22.23.2"
NODE_VER_SHORT="22.23.2"
# --- 素材系统 (B1/M1): example-settings 与 node 运行时的三级回退 ---
# ① 工作区缓存/旧构建目录 → ② archive 旧包解包 → ③ settings.yaml 脱敏生成 (仅 example-settings)
NODE_TARBALL="$WORKSPACE/.temp/dsh-deploy/downloads/node-$NODE_VERSION-linux-x64-musl.tar.xz"
NODE_SHA256="2d18b5731055f7efa6c899004909b00ee110e38d3775745f60ec9ccf1f9982e7"
OLD_PKG_DIR="$WORKSPACE/.temp/dsh-deploy"             # 素材一级来源(可不存在, 见 resolve_material)
ARCHIVE_PKG="$WORKSPACE/.temp/archive/dsh-router-install-v0.1.2.tar.gz"   # 素材二级来源: 上一版成功包
ARCHIVE_PREFIX="dsh-router-install-v0.1.2"            # 旧包内顶层目录名
SETTINGS_SRC="$HOME/.dsh/settings.yaml"               # 素材三级来源: 本机生效配置 (脱敏后作模板)
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
    # M2: rm -rf 仅允许清理本次构建工作区 (.temp/dsh-deploy*), 防止误伤 archive/旧包/其他
    case "$DEPLOY_DIR" in
        "$WORKSPACE"/.temp/dsh-deploy*) : ;;
        *) die "DEPLOY_DIR 配置异常, 拒绝清理: $DEPLOY_DIR" ;;
    esac
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
# 素材解析 (B1/M1): 三级来源回退, 三路皆缺时给出明确提示并 die
#   resolve_material example-settings  → $PKG_DIR/install/example-settings.yaml
#   resolve_material node-runtime      → $DEPLOY_DIR/node-src (已含 lib/ 兜底库)
#   每一路成功都会记录来源到 $MATERIAL_LOG (供 MANIFEST 与执行日志引用)
# =============================================================================
MATERIAL_LOG="$DEPLOY_DIR/material-source.txt"
MATERIAL_SOURCE_EXAMPLE="（未解析）"
MATERIAL_SOURCE_NODE="（未解析）"

resolve_material() {
    local name="$1"
    case "$name" in
        example-settings) resolve_material_example_settings ;;
        node-runtime)     resolve_material_node_runtime ;;
        *) die "未知素材名: $name" ;;
    esac
}

# --- B1-素材1: install/example-settings.yaml (三级回退) ---
resolve_material_example_settings() {
    local dest="$PKG_DIR/install/example-settings.yaml"
    mkdir -p "$(dirname "$dest")"
    # ① 工作区缓存 / 旧构建目录
    if [ -f "$OLD_PKG_DIR/install/example-settings.yaml" ]; then
        cp "$OLD_PKG_DIR/install/example-settings.yaml" "$dest"
        MATERIAL_SOURCE_EXAMPLE="① 工作区缓存 $OLD_PKG_DIR/install/example-settings.yaml"
        return 0
    fi
    # ② 旧包 archive 解包提取
    if [ -f "$ARCHIVE_PKG" ] && tar -tzf "$ARCHIVE_PKG" "$ARCHIVE_PREFIX/install/example-settings.yaml" >/dev/null 2>&1; then
        mkdir -p "$DEPLOY_DIR/mat-extract"
        tar -xzf "$ARCHIVE_PKG" -C "$DEPLOY_DIR/mat-extract" --strip-components=2 \
            "$ARCHIVE_PREFIX/install/example-settings.yaml" 2>>"$LOG" \
            || die "从旧包提取 example-settings.yaml 失败: $ARCHIVE_PKG"
        cp "$DEPLOY_DIR/mat-extract/example-settings.yaml" "$dest"
        MATERIAL_SOURCE_EXAMPLE="② 旧包解包 $ARCHIVE_PKG (install/example-settings.yaml)"
        return 0
    fi
    # ③ 从本机 ~/.dsh/settings.yaml 脱敏生成模板 (占位 key 结构参考旧模板注释格式)
    if [ -f "$SETTINGS_SRC" ]; then
        python3 - "$SETTINGS_SRC" "$dest" <<'PYEOF' >>"$LOG" 2>&1 || die "settings.yaml 脱敏生成模板失败"
import sys, yaml, datetime

src, dst = sys.argv[1], sys.argv[2]
data = yaml.safe_load(open(src))
if not isinstance(data, dict):
    raise SystemExit("settings.yaml 顶层不是映射, 拒绝生成")

# 深拷贝并脱敏: 任何疑似密钥的值 (key/token/secret/apiKey) 替换为占位符
def mask(node, path=()):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            lk = str(k).lower()
            keyish = any(t in lk for t in ("key", "token", "secret", "password", "apikey"))
            if keyish and isinstance(v, str) and v:
                out[k] = "******** (请填真实 key)"
            else:
                out[k] = mask(v, path + (k,))
        return out
    if isinstance(node, list):
        return [mask(x, path) for x in node]
    return node

masked = mask(data)

header = (
    "# dsh 首启配置模板 (自动生成: v0.1.3 build)\n"
    "# 安装后生效路径: /srv/dsh/home/settings.yaml  (DSH_HOME=/srv/dsh/home)\n"
    "#\n"
    "# ⚠️ 自动生成模板: 脱敏自本机运行配置 (~/.dsh/settings.yaml), 请填真实 key!\n"
    "#    密钥不进包: 本文件不含任何真实 key。providers 用 apiKeyEnv 引用环境变量:\n"
    "#    方式一: 编辑 /srv/dsh/home/settings.yaml 填入模型列表 (本文件即模板)\n"
    "#    方式二: 建 /srv/dsh/home/dsh.env 并写入 (init 脚本 /etc/init.d/dsh 自动载入):\n"
    "#        <APIKEY_ENV_NAME>=sk-xxxx\n"
    "#    改完保存后重启服务: /etc/init.d/dsh restart\n"
)
with open(dst, "w") as f:
    f.write(header)
    yaml.safe_dump(masked, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
print(f"[gen-template] {dst} 已生成 (脱敏自 {src}, {datetime.date.today()})")
PYEOF
        MATERIAL_SOURCE_EXAMPLE="③ 本机 ~/.dsh/settings.yaml 脱敏自动生成"
        return 0
    fi
    die "素材缺失: example-settings.yaml 三级回退均不可用 (无工作区缓存 / 无旧包 $ARCHIVE_PKG / 无 $SETTINGS_SRC)"
}

# --- B1-素材2: node 运行时 (优先下载缓存, 下载/校验失败时复用旧包 node/) ---
# 注: prepare_node 内先尝试缓存 tar.xz, 失败后调用本函数兜底 (旧包 node/ 已含 lib/ 兜底库)
resolve_material_node_runtime() {
    local NODE_SRC="$DEPLOY_DIR/node-src"
    rm -rf "$NODE_SRC"; mkdir -p "$NODE_SRC"
    if [ -f "$ARCHIVE_PKG" ] && tar -tzf "$ARCHIVE_PKG" "$ARCHIVE_PREFIX/node/bin/node" >/dev/null 2>&1; then
        log_warn "下载缓存不可用 → 复用旧包 node/ 运行时 (B1 兜底)"
        tar -xzf "$ARCHIVE_PKG" -C "$NODE_SRC" --strip-components=2 \
            "$ARCHIVE_PREFIX/node" 2>>"$LOG" \
            || die "从旧包提取 node/ 运行时失败: $ARCHIVE_PKG"
        [ -x "$NODE_SRC/bin/node" ] || die "旧包提取后缺 node/bin/node"
        # 复制后验证: musl node 在宿主机(glibc)无法直接运行, 用 alpine 容器真机验证
        docker run --rm -v "$NODE_SRC:/srv/node:ro" -e LD_LIBRARY_PATH=/srv/node/lib \
            "$ALPINE_IMG" sh -c '/srv/node/bin/node --version' >>"$LOG" 2>&1 \
            || die "旧包 node 兜底容器验证失败 (node --version)"
        MATERIAL_SOURCE_NODE="② 旧包解包 $ARCHIVE_PKG (node/, 含 lib/ 兜底库)"
        log_ok "旧包 node 运行时就绪且容器内 node --version 通过"
        return 0
    fi
    die "素材缺失: node 运行时下载失败且旧包 $ARCHIVE_PKG 不可用 (无 node/bin/node)"
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
# 3b. musl 版 sharp 原生模块注入 (v0.1.4 修复 A)
#     pnpm deploy 的闭包只带 glibc (linux-x64) 平台包; ImmortalWrt (musl) 加载
#     二进制失败 -> attachment-local 插件挂载即崩 (Could not load the "sharp"
#     module using the linuxmusl-x64 runtime). 此处把官方 musl 平台包注入
#     .pnpm 闭包, 并在 sharp 主包实例 node_modules/@img 与顶层 @img 建相对
#     symlink, 使 sharp 在 musl 下经 require("@img/sharp-linuxmusl-x64") 解析
#     到 musl 二进制 (平台解析逻辑: sharp/dist/sharp.cjs 按 detect-libc 选 runtimePlatform).
#     版本从闭包内已有 glibc 平台包动态读取, 避免硬编码; 素材优先本地缓存
#     .temp/sharp-musl-check/, 缺失则从 npm registry 下载 (目标机无需 pnpm/npm).
# =============================================================================
inject_musl_sharp() {
    log_info "注入 musl 版 sharp 原生模块 ..."
    local NM="$DEPLOY_DIR/app/node_modules"
    local PNPM="$NM/.pnpm"
    local CACHE="$WORKSPACE/.temp/sharp-musl-check"
    [ -d "$PNPM" ] || die "闭包无 .pnpm 目录, 无法注入 musl sharp"

    # 从闭包内已有 glibc 平台包读取版本 (pnpm 实例目录名如 @img+sharp-linux-x64@0.35.3)
    local gnu_dir gnu_ver vips_dir vips_ver
    gnu_dir="$(ls -d "$PNPM"/@img+sharp-linux-x64@* 2>/dev/null | head -1 || true)"
    [ -n "$gnu_dir" ] || die "闭包缺 glibc sharp 平台包 (@img+sharp-linux-x64@*), 注入中止"
    gnu_ver="$(basename "$gnu_dir" | sed -n 's/^@img+sharp-linux-x64@//p')"
    vips_dir="$(ls -d "$PNPM"/@img+sharp-libvips-linux-x64@* 2>/dev/null | head -1 || true)"
    [ -n "$vips_dir" ] || die "闭包缺 glibc sharp-libvips 平台包 (@img+sharp-libvips-linux-x64@*), 注入中止"
    vips_ver="$(basename "$vips_dir" | sed -n 's/^@img+sharp-libvips-linux-x64@//p')"
    log_info "  sharp 闭包版本: sharp $gnu_ver + libvips $vips_ver (glibc)"

    # 逐个注入 musl 平台包 (实体拷贝进 .pnpm 实例目录, 目录名沿用 pnpm 惯例 @img+<pkg>@<ver>)
    # 参数: 包名(如 sharp-linuxmusl-x64) / 版本 / 本地 tarball 基名(如 img-sharp-linuxmusl-x64)
    inject_one() {
        local name="$1" ver="$2" tgz_base="$3"
        local tgz="$CACHE/$tgz_base-$ver.tgz"
        if [ ! -f "$tgz" ]; then
            log_warn "本地缓存缺 $tgz_base-$ver.tgz, 尝试从 npm registry 下载 ..."
            mkdir -p "$CACHE"
            local url="https://registry.npmjs.org/@img/$name/-/$name-$ver.tgz"
            if command -v curl >/dev/null 2>&1; then
                curl -fsSL --retry 3 "$url" -o "$tgz" >>"$LOG" 2>&1 \
                    || die "musl 平台包下载失败: $url (可手动放入 $CACHE/)"
            elif command -v wget >/dev/null 2>&1; then
                wget -q -O "$tgz" "$url" >>"$LOG" 2>&1 \
                    || die "musl 平台包下载失败: $url (可手动放入 $CACHE/)"
            else
                die "本地无 curl/wget 且缺缓存 $tgz; 请手动下载 $url 放入 $CACHE/"
            fi
            log_ok "已下载 $name-$ver.tgz"
        fi
        local inst_root="$PNPM/@img+$name@$ver"
        local dest="$inst_root/node_modules/@img/$name"
        if [ ! -f "$dest/package.json" ]; then
            local tmp
            tmp="$(mktemp -d "$DEPLOY_DIR/inject-XXXXXX")"
            tar -xzf "$tgz" -C "$tmp" 2>>"$LOG" || { rm -rf "$tmp"; die "musl 平台包解压失败: $tgz"; }
            # 注入目标均位于构建工作区 ($DEPLOY_DIR) 内
            rm -rf "$dest"
            mkdir -p "$(dirname "$dest")"
            cp -a "$tmp/package" "$dest"
            rm -rf "$tmp"
            log_ok "注入 $name@$ver -> ${dest#$DEPLOY_DIR/}"
        else
            log_info "  $name@$ver 已存在, 跳过"
        fi
    }
    inject_one sharp-linuxmusl-x64 "$gnu_ver" img-sharp-linuxmusl-x64
    inject_one sharp-libvips-linuxmusl-x64 "$vips_ver" img-sharp-libvips-linuxmusl-x64

    # 关键: sharp musl 实例内要有 libvips 同级 symlink —— .node 二进制的 RPATH 首项
    # $ORIGIN/../../sharp-libvips-linuxmusl-x64/lib 据此找到 libvips-cpp.so (与 pnpm
    # 对 glibc 平台包的原生布局一致: @img+sharp-linux-x64@*/node_modules/@img 内同级链)
    local musl_inst="$PNPM/@img+sharp-linuxmusl-x64@$gnu_ver/node_modules/@img"
    if [ ! -e "$musl_inst/sharp-libvips-linuxmusl-x64" ]; then
        ln -s "../../../@img+sharp-libvips-linuxmusl-x64@$vips_ver/node_modules/@img/sharp-libvips-linuxmusl-x64" \
            "$musl_inst/sharp-libvips-linuxmusl-x64"
        log_ok "链接 ${musl_inst#$DEPLOY_DIR/}/sharp-libvips-linuxmusl-x64"
    fi

    # 建 symlink: sharp 主包实例内 node_modules/@img + 顶层 node_modules/@img
    local sharp_inst
    sharp_inst="$(ls -d "$PNPM"/sharp@*/node_modules/@img 2>/dev/null | head -1 || true)"
    [ -n "$sharp_inst" ] || die "闭包缺 sharp 主包实例 (sharp@*/node_modules/@img), 注入中止"
    link_musl() {
        local name="$1" ver="$2"
        # sharp 实例内 (require 解析主路径): ../../../@img+$name@$ver/node_modules/@img/$name
        if [ ! -e "$sharp_inst/$name" ]; then
            ln -s "../../../@img+$name@$ver/node_modules/@img/$name" "$sharp_inst/$name"
            log_ok "链接 ${sharp_inst#$DEPLOY_DIR/}/$name"
        fi
        # 顶层 @img (扁平覆盖层): ../.pnpm/@img+$name@$ver/node_modules/@img/$name
        mkdir -p "$NM/@img"
        if [ ! -e "$NM/@img/$name" ]; then
            ln -s "../.pnpm/@img+$name@$ver/node_modules/@img/$name" "$NM/@img/$name"
            log_ok "链接 ${NM#$DEPLOY_DIR/}/@img/$name"
        fi
    }
    link_musl sharp-linuxmusl-x64 "$gnu_ver"
    link_musl sharp-libvips-linuxmusl-x64 "$vips_ver"

    # 注入后自查: musl 二进制 .node / libvips .so 必须存在
    ls "$PNPM"/@img+sharp-linuxmusl-x64@*/node_modules/@img/sharp-linuxmusl-x64/lib/*.node >/dev/null 2>&1 \
        || die "musl sharp 二进制缺失 (注入后自查失败)"
    ls "$PNPM"/@img+sharp-libvips-linuxmusl-x64@*/node_modules/@img/sharp-libvips-linuxmusl-x64/lib/libvips-cpp.so* >/dev/null 2>&1 \
        || die "musl libvips 缺失 (注入后自查失败)"
    log_ok "musl 版 sharp 原生模块注入完成"
}

# =============================================================================
# 4. musl node 运行时准备 (缓存 tar.xz -> strip -> 附带 libstdc++/libgcc_s)
# =============================================================================
prepare_node() {
    log_info "准备 musl node $NODE_VERSION ..."
    local NODE_SRC="$DEPLOY_DIR/node-src"
    local FROM_ARCHIVE=0
    if [ -f "$NODE_TARBALL" ] \
        && echo "$NODE_SHA256  $NODE_TARBALL" | sha256sum -c - >/dev/null 2>&1; then
        log_info "使用本地缓存: $NODE_TARBALL (sha256 已校验)"
        MATERIAL_SOURCE_NODE="① 本地缓存 $NODE_TARBALL"
    elif [ ! -f "$NODE_TARBALL" ]; then
        # 无缓存 → 尝试下载 (unofficial-builds, curl retry 3)
        log_warn "本地无 musl node 缓存, 尝试下载 (unofficial-builds)"
        mkdir -p "$(dirname "$NODE_TARBALL")"
        if curl -fL --retry 3 -o "$NODE_TARBALL" \
            "https://unofficial-builds.nodejs.org/download/release/$NODE_VERSION/node-$NODE_VERSION-linux-x64-musl.tar.xz" \
            >>"$LOG" 2>&1 \
            && echo "$NODE_SHA256  $NODE_TARBALL" | sha256sum -c - >/dev/null 2>&1; then
            log_ok "musl node 下载成功且 sha256 校验通过"
            MATERIAL_SOURCE_NODE="① 下载缓存 $NODE_TARBALL"
        else
            log_warn "musl node 下载失败或校验失败, 进入 B1 兜底 (复用旧包 node/)"
            FROM_ARCHIVE=1
        fi
    else
        log_warn "缓存 tar.xz 存在但 sha256 校验失败, 进入 B1 兜底 (复用旧包 node/)"
        FROM_ARCHIVE=1
    fi

    if [ "$FROM_ARCHIVE" = 1 ]; then
        resolve_material node-runtime
        return 0
    fi

    # ---- 正常路径: 从 tar.xz 解包 ----
    rm -rf "$NODE_SRC"; mkdir -p "$NODE_SRC"
    tar -xJf "$NODE_TARBALL" -C "$NODE_SRC" --strip-components=1
    local BIN="$NODE_SRC/bin/node"
    [ -x "$BIN" ] || die "musl node 解包后缺二进制"

    # strip (官方 musl 二进制未 strip)
    strip --strip-unneeded "$BIN" 2>/dev/null && log_info "node 二进制已 strip" || log_warn "strip 失败(保留原样, 不影响运行)"
    # 移除编译头文件与文档 (运行时不需要)
    rm -rf "$NODE_SRC/include" "$NODE_SRC/share" "$NODE_SRC/CHANGELOG.md" "$NODE_SRC/README.md" 2>/dev/null || :

    # 附带 musl libstdc++ / libgcc_s (严格验证发现: node 依赖这两个库, 目标机未必预装)
    local LIBC_DIR="$NODE_SRC/lib"
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
    # B1/M1: example-settings 素材三级回退 (缓存 → 旧包解包 → settings.yaml 脱敏生成)
    resolve_material example-settings
    # init.d/dsh 由下方 heredoc 完整生成, 无需从素材复制
    log_info "素材来源: example-settings = $MATERIAL_SOURCE_EXAMPLE"
    log_info "素材来源: node = $MATERIAL_SOURCE_NODE"
    : > "$MATERIAL_LOG"
    echo "example-settings: $MATERIAL_SOURCE_EXAMPLE" | tee -a "$MATERIAL_LOG"
    echo "node: $MATERIAL_SOURCE_NODE" | tee -a "$MATERIAL_LOG"

    # ---- 生成 install.sh (v0.1.3: 新增 LD_LIBRARY_PATH 启动 + libstdc++ 检测提示)
    cat > "$PKG_DIR/install.sh" <<'SH'
#!/bin/sh
# dsh 软路由一键安装脚本 (dsh-router-install-v0.1.4)
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
#   7) 启动自检 (v0.1.4): 真实启动服务 + 探活 3080 + 日志崩溃关键字检查
#
# 注意: 密钥不进包; 首次使用请编辑 /srv/dsh/home/settings.yaml
#       或建 /srv/dsh/home/dsh.env (AGNES_API_KEY / OPENCODE_GO_API_KEY ...)
# v0.1.4 修复 (相对 v0.1.3): 内置 musl 版 sharp 原生模块 / init 启动带
#       --expose-internals / --trusted-host 默认单 IP 自动探测 (不再用 CIDR) /
#       本安装后启动自检

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

# 6) 启动自检 (v0.1.4): 真实启动 + 探活 + 日志崩溃关键字检查
say "启动 dsh 服务并自检 (端口 3080) ..."
"$DSH_INIT" start 2>&1 | sed 's/^/    /'
HTTP_CODE=""
i=0
while [ "$HTTP_CODE" != "200" ] && [ "$i" -lt 30 ]; do
	if command -v curl >/dev/null 2>&1; then
		HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/ 2>/dev/null || true)"
	else
		wget -q -O /dev/null http://127.0.0.1:3080/ 2>/dev/null && HTTP_CODE=200 || HTTP_CODE=000
	fi
	[ "$HTTP_CODE" = "200" ] && break
	i=$((i+1))
	sleep 1
done
if [ "$HTTP_CODE" = "200" ]; then
	say "启动自检通过: http://127.0.0.1:3080/ -> 200 (${i}s 内)"
else
	echo "[dsh-install] 启动自检失败 (HTTP=$HTTP_CODE). dsh.log 尾部:"
	[ -f /var/log/dsh.log ] && tail -40 /var/log/dsh.log | sed 's/^/    /'
	echo "[dsh-install] 常见原因与处理:"
	echo "  a) 资源不足/端口占用: 查看 /var/log/dsh.log"
	echo "  b) 日志出现 Could not load the \"sharp\" module 或 --expose-internals is required:"
	echo "     安装包版本过旧 (需 v0.1.4+, 内置 musl sharp 与 --expose-internals)"
	echo "  c) 日志出现 trustedHosts entry ... is not a bare host:port:"
	echo "     在 $DSH_HOME/dsh.env 设 DSH_TRUSTED_HOSTS=<路由器单IP> 后 /etc/init.d/dsh restart"
	exit 1
fi

cat <<EOF

[dsh-install] 完成。首次使用请:
  1) 编辑 $SETTINGS_TARGET 填入模型 provider 与 key:
     - 或建 $DSH_HOME/dsh.env 导出环境变量 (AGNES_API_KEY / OPENCODE_GO_API_KEY)
  2) 服务已在运行: /etc/init.d/dsh start (启动自检已通过)
  3) 打开浏览器访问: http://<路由器IP>:3080
  日志: /var/log/dsh.log   开机自启: 已启用 (S95dsh)
EOF
SH
    chmod +x "$PKG_DIR/install.sh"

    # ---- 更新 etc/init.d/dsh: 版本注记 + LD_LIBRARY_PATH + --trusted-host 单IP + --expose-internals
    cat > "$PKG_DIR/etc/init.d/dsh" <<'SH'
#!/bin/sh /etc/rc.common
# dsh — DeepSeek Harness web 服务（软路由 AI 网关前端）
# 来源: dsh-router-install-v0.1.4 安装包  版本: v0.1.4
#
# v0.1.4 修复 (相对 v0.1.3, 软路由真机三个「启动即崩」):
#   1) 启动命令带 --expose-internals —— HMR 服务 (cordis-plugin-hmr) 构造时
#      需访问 Node 内部模块加载器; 无该 flag 且 node-addon-require-builtin 的
#      glibc 原生绑定在 musl 上不可用时抛 "--expose-internals is required"。
#   2) --trusted-host 默认值改单 IP 自动探测 —— dsh-client-connection 只接受
#      裸 host[:port], 不接受 CIDR 网段; v0.1.3 默认 10.10.10.0/24 会启动崩溃。
#   3) (配合) 包内已内置 musl 版 sharp 原生模块, 修复 attachment 加载崩溃。
#
# v0.1.3 保留: 启动命令注入 LD_LIBRARY_PATH (包内 musl libstdc++/libgcc_s 兜底);
#         严格可执行性验证 (alpine musl 容器中验证过 node/dsh/web 启动)。
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
# 局域网信任主机 (特权方法 --trusted-host, 只接受裸 host[:port], 不支持 CIDR 网段)
# 优先级: dsh.env/环境变量 DSH_TRUSTED_HOSTS > 自动探测本机 LAN IP > 127.0.0.1(仅回环)
# 注意: 探测到的是路由器自身的 IP; 客户端浏览器用哪个 IP 访问, 就需要信任哪个 IP,
#       无法探测或需多 IP 时请在 /srv/dsh/home/dsh.env 显式设 DSH_TRUSTED_HOSTS。
DSH_TRUSTED_HOSTS="${DSH_TRUSTED_HOSTS:-}"
if [ -z "$DSH_TRUSTED_HOSTS" ]; then
	# OpenWrt/ImmortalWrt 惯用法: uci 取 LAN 接口静态 IP (静态配置的局域网)
	DSH_TRUSTED_HOSTS="$(uci get network.lan.ipaddr 2>/dev/null || true)"
fi
if [ -z "$DSH_TRUSTED_HOSTS" ] || [ "$DSH_TRUSTED_HOSTS" = "0.0.0.0" ]; then
	# 兜底: ip 命令取本机全局 IPv4 (覆盖 DHCP 场景; 若命中 WAN 也仅放宽到该单 IP)
	DSH_TRUSTED_HOSTS="$(ip -o -4 addr show scope global 2>/dev/null | awk '{print $4; exit}' | cut -d/ -f1)"
fi
: "${DSH_TRUSTED_HOSTS:=127.0.0.1}"
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
	procd_set_param command /bin/sh -c "cd '$APP_DIR' && exec '$NODE_DIR/bin/node' --expose-internals lib/bin.js web --host '$DSH_HOST' --port '$DSH_PORT' --trusted-host '$DSH_TRUSTED_HOSTS' >> '$DSH_LOG' 2>&1"
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

DeepSeek Harness (dsh) 面向软路由/ImmortalWrt 的一键部署包 **$VERSION** ($BUILD_DATE)。
在软路由上以 **procd 服务** 挂载 dsh web 网关 (端口 **3080**)，局域网内手机/PC/电视盒子免安装浏览器直接使用。

> 构建自 harness commit \`$HARNESS_COMMIT\` (feature/lan-access, web 前端含 LAN/remote 修复)。
> **本包 (v0.1.3) 通过「严格可执行性检测」**：musl node 与 dsh 全程在 alpine (真实 musl libc)
> 容器内以 \`/srv/dsh\` 双目录布局真机级验证 (node --version / dsh --version / dump-config / web HTTP 200)。

---

## 1. 包内容

| 路径 | 说明 |
|---|---|
| \`app/\` | dsh 运行闭包 (\`lib/bin.js\` 入口 + node_modules prod 依赖 + web 前端 + 全部插件) |
| \`node/\` | Node.js **linux-x64-musl** v$NODE_VER_SHORT 官方运行时 (unofficial-builds, 已 strip) + **musl libstdc++/libgcc_s 兜底库** (\`node/lib/\`) |
| \`install.sh\` | 一键安装脚本 (BusyBox ash, root 运行; 含 node 自检 + 安装后真实启动自检) |
| \`install/example-settings.yaml\` | 首启配置模板 (密钥占位, **不含任何真实 key**) |
| \`etc/init.d/dsh\` | procd 开机自启服务脚本 (LD_LIBRARY_PATH 注入 + \`--expose-internals\` + trusted-host 单IP自动探测 + respawn 崩溃自愈) |
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

## 5. v0.1.3 变更

1. **严格可执行性检测** (v0.2 起): 全部 shell 脚本 bash -n 语法校验; musl node 在 alpine
   (真实 musl) 容器中真机运行 node --version / dsh --version / dump-config / web 启动 HTTP 200;
   包内容按 \`/srv/dsh\` 目录布局组装后整体启动验证。
2. **musl 库兜底**: 发现官方 musl node 依赖 libstdc++/libgcc_s (v0.1.1 未真机验证出此依赖),
   现随包附带 musl 版至 \`node/lib/\`, 启动命令注入 \`LD_LIBRARY_PATH\`, 目标机缺库也能启动。
3. **web 前端重建**: 包含 08-23 LAN/remote 修复及 08-25 guard/tool-cordis 等最新 commit。
4. **构建溯源**: 打包脚本 \`scripts/build-dsh-router-package.sh\` v$SCRIPT_VERSION, 产物带时间戳日志与 MANIFEST.txt
   (记录 harness commit 与素材来源: example-settings / node 运行时三级回退)。
5. **素材鲁棒性 (v0.1.3 修复)**: example-settings 模板与 musl node 运行时支持三级回退
   (工作区缓存 → 旧包解包 → settings.yaml 脱敏生成), 不再依赖已删除的 .temp/dsh-deploy 素材目录。

## 5a. v0.1.4 变更（软路由真机三崩溃修复，由 v0.1.3 实装反馈驱动）

1. **内置 musl 版 sharp 原生模块**: v0.1.3 的闭包只带 glibc (\`linux-x64\`) 平台包,
   ImmortalWrt (musl) 加载失败 → 启动即崩 (\`Could not load the "sharp" module using
   the linuxmusl-x64 runtime\`)。v0.1.4 把 \`@img/sharp-linuxmusl-x64\` +
   \`@img/sharp-libvips-linuxmusl-x64\` 官方 musl 包注入 \`.pnpm\` 闭包并建好
   symlink（版本从闭包 glibc 包动态读取），sharp 在 musl 下可正常解析到二进制。
2. **启动命令带 \`--expose-internals\`**: HMR 服务构造需访问 Node 内部模块加载器；
   无该 flag 且 \`node-addon-require-builtin\` 的 glibc 绑定在 musl 上不可用时抛
   \`--expose-internals is required for HMR service\` → 启动即崩。已内置该 flag。
3. **\`--trusted-host\` 默认值改单 IP 自动探测**: dsh 只接受裸 \`host[:port]\`，
   不接受 CIDR 网段；v0.1.3 默认 \`10.10.10.0/24\` 会在插件挂载时抛
   \`not a bare host[:port] authority\` → 启动即崩。v0.1.4 自动探测本机 LAN IP
   (\`uci get network.lan.ipaddr\` → \`ip\` 兜底)，可经 \`DSH_TRUSTED_HOSTS\` 环境变量/dsh.env 覆盖。
4. **安装后真实启动自检**: \`install.sh\` 装完即 \`/etc/init.d/dsh start\` + curl 探活
   :3080 + dsh.log 崩溃关键字检查，失败即停并给出处理指引（不再只做 node 版本自检）。

## 6. 已知限制

1. **node-pty (musl) 未真机验证**: 终端/子进程类能力依赖原生模块, 需软路由真机确认; 不可用时
   浏览器内终端不可用 (web 对话/网关核心不受影响), 替代: ssh/ttyd (:7681)。
   (sharp 已由 v0.1.4 内置 musl 版解决; 其他原生模块按需按平台裁剪)
2. **体积**: 整包解压 ≈360M; 瘦身方向留给后续版本 (去未用 provider、prebuild 按平台裁剪)。
3. **日志无轮转**: \`/var/log/dsh.log\` 持续增大; 可加 cron truncate 或 logrotate。
4. **配置热更新**: 改 \`settings.yaml\`/\`dsh.env\` 后需 \`/etc/init.d/dsh restart\` 生效。
5. **trusted-host 单 IP 探测的局限**: 探测到的是路由器自身 IP; 若浏览器用其他 IP 访问且需
   特权方法, 请在 \`/srv/dsh/home/dsh.env\` 显式设 \`DSH_TRUSTED_HOSTS\`。
MD

    # ---- MANIFEST.txt (L1: harness commit + 素材来源 + 关键文件校验; 打包后回填 sha256)
    cat > "$MANIFEST" <<MF
# dsh-router-install-$VERSION MANIFEST
# 生成时间: $TIMESTAMP
harness-commit: $HARNESS_COMMIT
package-version: $VERSION
package-name: $PKG_NAME
script-version: $SCRIPT_VERSION
node-version: $NODE_VER_SHORT (linux-x64-musl)
material-example-settings: $MATERIAL_SOURCE_EXAMPLE
material-node-runtime: $MATERIAL_SOURCE_NODE
nodes:
  - app/lib/bin.js
  - node/bin/node
  - install/example-settings.yaml
  - etc/init.d/dsh
  - install.sh
MF

    log_ok "安装包目录组装完成 (MANIFEST.txt 已生成)"
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
    check "install/example-settings.yaml" test -s "$PKG_DIR/install/example-settings.yaml"
    check "etc/init.d/dsh" test -x "$PKG_DIR/etc/init.d/dsh"
    check "MANIFEST.txt" test -s "$MANIFEST"

    # 6.4 ELF 解释器 (musl)
    log_info "ELF 检查:"
    file "$PKG_DIR/node/bin/node"
    file "$PKG_DIR/node/bin/node" | grep -q "ld-musl-x86_64" \
        || die "node 二进制不是 musl 动态链接 (预期 /lib/ld-musl-x86_64.so.1)"

    # 6.4b v0.1.4 三崩溃修复的静态回归检查
    # ① init 启动命令必须带 --expose-internals (HMR 服务构造要求)
    check "init.d/dsh 含 --expose-internals" grep -q -- "--expose-internals" "$PKG_DIR/etc/init.d/dsh"
    # ② init.d/dsh 不得再默认 CIDR 网段 (dsh 只接受裸 host[:port], CIDR 会启动崩溃)
    #    只拦「默认赋值」形态, 注释里的历史说明不算 (文档可保留)
    if grep -qE 'DSH_TRUSTED_HOSTS="\$\{DSH_TRUSTED_HOSTS:-10\.10\.10\.0/24\}"' "$PKG_DIR/etc/init.d/dsh"; then
        log_fail "init.d/dsh 仍把 DSH_TRUSTED_HOSTS 默认值写成 CIDR 10.10.10.0/24 (dsh 拒绝网段, 启动即崩)"
        exit 1
    fi
    log_ok "init.d/dsh 无 CIDR 默认值"
    # ③ musl sharp 平台包已注入闭包 (两处 .node / .so 存在)
    check "闭包 musl sharp .node" test -n "$(ls "$PKG_DIR"/app/node_modules/.pnpm/@img+sharp-linuxmusl-x64@*/node_modules/@img/sharp-linuxmusl-x64/lib/*.node 2>/dev/null | head -1)"
    check "闭包 musl libvips .so" test -n "$(ls "$PKG_DIR"/app/node_modules/.pnpm/@img+sharp-libvips-linuxmusl-x64@*/node_modules/@img/sharp-libvips-linuxmusl-x64/lib/libvips-cpp.so* 2>/dev/null | head -1)"

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

    # d) musl sharp 原生模块加载 (v0.1.4 修复 A 的真机验证: 注入的 musl 平台包可被 sharp require)
    check "musl sharp 原生模块加载" docker run --rm \
        -v "$PKG_DIR/app:/srv/dsh/app:ro" \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e LD_LIBRARY_PATH="$LDPATH" \
        "$ALPINE_IMG" sh -c 'apk add --no-cache libstdc++ >/dev/null 2>&1 || :; cd /srv/dsh/app && /srv/dsh/node/bin/node -e "const s = require(\"sharp\"); console.log(\"SHARP-OK\", s.versions.sharp)"'

    # e) web 启动 + HTTP 200 + 进程稳定 (完整布局: app + node + home, 模拟 /srv/dsh; 在容器内 curl)
    #    DSH_HOME 用容器内路径 (dsh 首启自动初始化; 避免宿主目录 root 属主残留)
    #    v0.1.4: 启动命令带 --expose-internals (与 init.d/dsh 一致); HTTP 200 后继续等
    #    15s 跨过 sharp/HMR 崩溃窗口, 确认进程存活 + 日志无崩溃关键字
    #    (v0.1.3 的 sharp 崩溃表现为「先 200 后进程死」, 仅探活 200 不足以回归拦截)
    check "musl web 启动 + HTTP 200 + 进程稳定" docker run --rm \
        -v "$PKG_DIR/app:/srv/dsh/app:ro" \
        -v "$PKG_DIR/node:/srv/dsh/node:ro" \
        -e DSH_HOME=/tmp/dshhome \
        -e LD_LIBRARY_PATH="$LDPATH" \
        -w /srv/dsh/app \
        "$ALPINE_IMG" sh -c '
            apk add --no-cache libstdc++ curl >/dev/null 2>&1 || :
            mkdir -p /tmp/dshhome
            /srv/dsh/node/bin/node --expose-internals lib/bin.js web --host 127.0.0.1 --port 3099 --no-open >/tmp/dsh-web.log 2>&1 &
            WPID=$!
            ok=0
            for i in $(seq 1 40); do
                code=$(curl -s -o /tmp/page.html -w "%{http_code}" http://127.0.0.1:3099/ 2>/dev/null || true)
                [ "$code" = "200" ] && { ok=1; break; }
                kill -0 $WPID 2>/dev/null || break
                sleep 1
            done
            sleep 15
            if ! kill -0 $WPID 2>/dev/null; then
                echo "--- dsh-web.log (tail 40) ---"; tail -40 /tmp/dsh-web.log
                echo "process died (sharp/HMR 崩溃窗口)"; exit 1
            fi
            [ "$ok" = "1" ] || { echo "--- dsh-web.log (tail 40) ---"; tail -40 /tmp/dsh-web.log; exit 1; }
            grep -q "<div id=\"root\">" /tmp/page.html || { echo "page missing root div"; exit 1; }
            if grep -qE "Could not load the .sharp. module|--expose-internals is required|not a bare host" /tmp/dsh-web.log; then
                echo "--- 崩溃关键字命中 ---"; grep -E "Could not load the .sharp. module|--expose-internals is required|not a bare host" /tmp/dsh-web.log; exit 1
            fi
            echo "WEB-HTTP-200-STABLE-AND-NO-CRASH-KEYWORDS-OK"
        '

    # f) 布局: app 顶层 node_modules 的 @deepseek-ai 关键包存在 (loader 解析前提)
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
    # 回填 MANIFEST 关键文件 sha256 (源文件在 DEPLOY_DIR, 需在打包 tar 前计算)
    {
        echo
        echo "checksums:"
        for f in app/lib/bin.js node/bin/node install/example-settings.yaml etc/init.d/dsh install.sh README.md MANIFEST.txt; do
            sha256sum "$PKG_DIR/$f" 2>/dev/null | sed "s|$PKG_DIR/|  |"
        done
    } >> "$MANIFEST"

    ( cd "$DEPLOY_DIR" && tar czf "$OUTPUT_DIR/$PKG_NAME.tar.gz" "$PKG_NAME" )
    [ -s "$OUTPUT_DIR/$PKG_NAME.tar.gz" ] || die "tar 打包失败"
    # sha256 of 最终包文件, 同时写入日志与顶层 MANIFEST
    local PKG_SHA
    PKG_SHA="$(sha256sum "$OUTPUT_DIR/$PKG_NAME.tar.gz" | awk '{print $1}')"
    echo "$PKG_SHA  $OUTPUT_DIR/$PKG_NAME.tar.gz" | tee -a "$LOG"
    {
        echo
        echo "archive:"
        echo "  file: $PKG_NAME.tar.gz"
        echo "  sha256: $PKG_SHA"
        echo "  size-bytes: $(stat -c %s "$OUTPUT_DIR/$PKG_NAME.tar.gz")"
    } >> "$MANIFEST"
    # 顶层副本 (与包内一致, 便于构建侧直接查阅)
    cp "$MANIFEST" "$OUTPUT_DIR/$PKG_NAME.MANIFEST.txt"
    log_ok "安装包已生成: $OUTPUT_DIR/$PKG_NAME.tar.gz"
    log_ok "MANIFEST: $OUTPUT_DIR/$PKG_NAME.MANIFEST.txt"
    log_info "包体积: $(du -sh "$OUTPUT_DIR/$PKG_NAME.tar.gz" | cut -f1) (解压后约 360M)"
    log_info "解压后包内大小: $(du -sh "$PKG_DIR" | cut -f1)"
}

# =============================================================================
main() {
    preflight
    build_web
    deploy_closure
    fixup_closure
    inject_musl_sharp
    prepare_node
    assemble
    strict_verify
    package
    log_ok "全流程完成 ✅  安装包: $OUTPUT_DIR/$PKG_NAME.tar.gz"
}
main "$@"