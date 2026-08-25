#!/bin/bash
# =============================================================================
# dsh 迁移路径适配脚本 v1.0 (2026-08-25)
# -----------------------------------------------------------------------------
# 用途: dsh 体系从本机迁移到软路由/新机器后，一键把硬编码路径/IP 改写为新值。
#       用于迁移后执行 —— 本机当前不执行，不改变本机运行配置。
#
# 用法:
#   bash scripts/adapt-machine-paths.sh <新工作区路径> <新IP|--keep-ip> [--dry-run]
#
#   例:
#     bash scripts/adapt-machine-paths.sh /srv/dsh/DSF-work 10.10.10.10        # 实际改写
#     bash scripts/adapt-machine-paths.sh /srv/dsh/DSF-work --keep-ip          # 保留 IP 不变
#     bash scripts/adapt-machine-paths.sh /srv/dsh/DSF-work 10.10.10.10 --dry-run  # 只预览
#
# 功能:
#   ① 重写 docs/主agent可改写文件清单.yaml 中 /home/dingx/DSF-work 前缀为新路径
#   ② 依据本机 ~/.config/systemd/user/*.service 生成新版单元片段并打印到 stdout
#      (替换 /home/dingx → 新 HOME、--trusted-host 旧 IP → 新 IP；只管生成不执行 systemctl)
#   ③ 重写 scripts/build-dsh-router-package.sh 的 WORKSPACE= / HARNESS_DIR= 两行
#   ④ 每个被改写文件改前备份为 <文件>.bak-适配-<时间戳>
#   ⑤ 全程打印 diff 摘要；--dry-run 只预览不改写
#
# 可移植性: 旧值(OLD_*)全部可用环境变量覆盖，脚本内默认值仅作为当前机器标准布局的回退。
# 依赖: bash + python3，无网络、无 sudo。
# =============================================================================
set -euo pipefail

# ------------------------------------------------------------------ 参数解析
NEW_WORKSPACE="${1:-}"
NEW_IP="${2:-}"
DRY_RUN=0
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY_RUN=1; fi
done

usage() {
  cat <<'EOF'
用法: bash scripts/adapt-machine-paths.sh <新工作区路径> <新IP|--keep-ip> [--dry-run]

  <新工作区路径>  迁移后的 DSF-work 绝对路径，如 /srv/dsh/DSF-work
  <新IP|--keep-ip> 迁移后的 dsh 本机 IP；传 --keep-ip 表示 IP 不变(保留原 --trusted-host)
  --dry-run        只打印将做的替换与 diff 预览，不备份不改写

可移植性环境变量(可选覆盖旧值):
  OLD_WORKSPACE  OLD_HOME  OLD_HARNESS  OLD_IP1  OLD_IP2
  NEW_HOME  NEW_HARNESS  NEW_IP1  NEW_IP2   (默认按当前机器标准布局推导)
EOF
}

if [ -z "$NEW_WORKSPACE" ] || [ -z "$NEW_IP" ]; then
  usage
  exit 1
fi
if [ "${NEW_WORKSPACE:0:1}" != "/" ]; then
  echo "错误: <新工作区路径> 必须是绝对路径" >&2
  exit 1
fi

# ------------------------------------------------------------------ 旧值(可覆盖)
OLD_WORKSPACE="${OLD_WORKSPACE:-/home/dingx/DSF-work}"
OLD_HOME="${OLD_HOME:-/home/dingx}"
OLD_HARNESS="${OLD_HARNESS:-/home/dingx/deepseek-harness}"
OLD_IP1="${OLD_IP1:-10.10.10.9}"
OLD_IP2="${OLD_IP2:-100.67.219.105}"

# 新值默认推导: 新 HOME/HARNESS 与新工作区同级父目录对齐
NEW_HOME="${NEW_HOME:-$(dirname "$NEW_WORKSPACE")}"
NEW_HARNESS="${NEW_HARNESS:-$(dirname "$NEW_WORKSPACE")/deepseek-harness}"
if [ "$NEW_IP" = "--keep-ip" ]; then
  NEW_IP1="$OLD_IP1"; NEW_IP2="$OLD_IP2"; KEEP_IP=1
else
  NEW_IP1="${NEW_IP1:-$NEW_IP}"; NEW_IP2="${NEW_IP2:-$NEW_IP}"; KEEP_IP=0
fi

TS="$(date +%Y%m%d-%H%M%S)"
BAK_SUFFIX=".bak-适配-$TS"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_ROOT="$(dirname "$SCRIPT_DIR")"
YAML_FILE="$WS_ROOT/docs/主agent可改写文件清单.yaml"
BUILD_FILE="$SCRIPT_DIR/build-dsh-router-package.sh"
SVC_DIR="$HOME/.config/systemd/user"
TPL_DIR="$WS_ROOT/docs/service单元模板"   # 兜底: 本机无 systemd 单元时用模板生成片段

echo "================================================================"
echo " dsh 迁移路径适配  (dry-run=$DRY_RUN)"
echo " 旧: workspace=$OLD_WORKSPACE  home=$OLD_HOME  harness=$OLD_HARNESS"
echo "     ip1=$OLD_IP1  ip2=$OLD_IP2"
echo " 新: workspace=$NEW_WORKSPACE  home=$NEW_HOME  harness=$NEW_HARNESS"
echo "     ip1=$NEW_IP1  ip2=$NEW_IP2"
echo "================================================================"

BACKED_UP=""

# ------------------------------------------------------------------ python3 单文件替换器
# 用法: rewrite_file <file> <mode> [scope]
#   mode=write : 打印 diff；非 dry-run 时 备份 → 写回源文件
#   mode=print : 只打印完整替换后内容(用于 service 片段输出, 不写盘)
#   scope=ws   : 仅替换工作区/仓库前缀(yaml、打包脚本；不碰 HOME/IP 与历史说明文字)
#   scope=full : 全量替换含 HOME 前缀与 --trusted-host IP (service 单元)
rewrite_file() {
  local file="$1"; shift
  local mode="${1:-write}"
  local scope="${2:-full}"
  [ -f "$file" ] || { echo "  !! 跳过(不存在): $file"; return 1; }
  local tmp
  tmp="$(mktemp)"
  OLD_WORKSPACE="$OLD_WORKSPACE" OLD_HOME="$OLD_HOME" OLD_HARNESS="$OLD_HARNESS" \
  OLD_IP1="$OLD_IP1" OLD_IP2="$OLD_IP2" \
  NEW_WORKSPACE="$NEW_WORKSPACE" NEW_HOME="$NEW_HOME" NEW_HARNESS="$NEW_HARNESS" \
  NEW_IP1="$NEW_IP1" NEW_IP2="$NEW_IP2" KEEP_IP="$KEEP_IP" SCOPE="$scope" \
  python3 - "$file" "$tmp" "$mode" <<'PYEOF'
import os, sys
src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, encoding='utf-8') as f:
    text = f.read()
O = os.environ
old = {'HN': O['OLD_HARNESS'], 'WS': O['OLD_WORKSPACE'], 'HOME': O['OLD_HOME'],
       'IP1': O['OLD_IP1'], 'IP2': O['OLD_IP2']}
new = {'HN': O['NEW_HARNESS'], 'WS': O['NEW_WORKSPACE'], 'HOME': O['NEW_HOME'],
       'IP1': O['NEW_IP1'], 'IP2': O['NEW_IP2']}
keep_ip = O.get('KEEP_IP') == '1'
scope = O.get('SCOPE', 'full')

# 替换顺序: 最长前缀优先，防止 harness/DSF-work 被 home 前缀抢先覆盖
repl = [(old['HN'], new['HN']), (old['WS'], new['WS'])]
if scope == 'full':
    repl += [(old['HOME'] + '/', new['HOME'] + '/'), (old['HOME'], new['HOME'])]
out = text
for o, n in repl:
    if o and o != n and o in out:
        out = out.replace(o, n)
if scope == 'full' and not keep_ip:
    out = out.replace('--trusted-host %s' % old['IP1'], '--trusted-host %s' % new['IP1'])
    out = out.replace('--trusted-host %s' % old['IP2'], '--trusted-host %s' % new['IP2'])

if mode == 'print':
    sys.stdout.write(out)
    sys.exit(0)

# mode == 'write': 统计并打印 diff 摘要
src_lines = text.splitlines(keepends=True)
out_lines = out.splitlines(keepends=True)
changed = 0
for i in range(max(len(src_lines), len(out_lines))):
    la = src_lines[i] if i < len(src_lines) else ''
    lb = out_lines[i] if i < len(out_lines) else ''
    if la != lb:
        changed += 1
        if changed <= 40:  # 防止过长输出
            print("  - %s" % la.rstrip("\n"))
            print("  + %s" % lb.rstrip("\n"))
print("  [%d 行变化]" % changed)
if changed == 0:
    os.unlink(dst)
    sys.exit(0)
with open(dst, 'w', encoding='utf-8') as f:
    f.write(out)
PYEOF
  local rc=$?
  if [ "$mode" = "print" ]; then
    return 0
  fi
  if [ "$rc" -ne 0 ]; then rm -f "$tmp"; return "$rc"; fi
  if [ ! -f "$tmp" ]; then rm -f "$tmp"; return 1; fi   # 无变化
  if [ "$DRY_RUN" = "1" ]; then
    rm -f "$tmp"
    return 0
  fi
  # 备份 → 写回
  if [ -z "$BACKED_UP" ] || ! echo "$BACKED_UP" | grep -q "^$file$"; then
    if [ ! -f "$file$BAK_SUFFIX" ]; then
      cp -p "$file" "$file$BAK_SUFFIX"
      echo "  备份: $(basename "$file")$BAK_SUFFIX"
    fi
  fi
  mv "$tmp" "$file"
  return 0
}

# ------------------------------------------------------------------ ① yaml 白名单
echo ""
echo "[1/3] 重写 yaml 白名单路径前缀: $YAML_FILE"
rewrite_file "$YAML_FILE" write ws || true

# ------------------------------------------------------------------ ② service 单元片段(仅输出)
echo ""
echo "[2/3] 依据本机 systemd 单元生成新版片段 (不写盘、不执行 systemctl)"
for unit in dsh-web.service config-ui.service; do
  src_svc="$SVC_DIR/$unit"
  if [ ! -f "$src_svc" ]; then
    echo "  !! 本机无 $unit，尝试模板兜底: $TPL_DIR/$unit.template"
    src_svc="$TPL_DIR/$unit.template"
  fi
  if [ ! -f "$src_svc" ]; then
    echo "  !! 跳过: $unit 无源可用"
    continue
  fi
  echo ""
  echo "===== 新版 $unit (迁移到新机器后放入 ~/.config/systemd/user/ 并 daemon-reload) ====="
  rewrite_file "$src_svc" print
done

# ------------------------------------------------------------------ ③ 打包脚本两行
echo ""
echo "[3/3] 重写打包脚本 WORKSPACE=/HARNESS_DIR=: $BUILD_FILE"
rewrite_file "$BUILD_FILE" write ws || true

# ------------------------------------------------------------------ 收尾
echo ""
if [ "$DRY_RUN" = "1" ]; then
  echo "【dry-run】以上为预览，未备份、未改写任何文件。"
else
  echo "【完成】yaml 与打包脚本已改写并备份($BAK_SUFFIX)；service 片段仅输出未写盘。"
  echo "提示: 迁移到新机器后，service 片段需自行放入新机器 ~/.config/systemd/user/ 并执行"
  echo "      systemctl --user daemon-reload (systemd 重载属迁移时用户操作)。"
fi

exit 0