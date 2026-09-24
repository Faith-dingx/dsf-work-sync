#!/bin/sh
# apply.sh — 在其他 OpenWrt/ImmortalWrt(x86_64, musl) 设备上恢复 dsh 的 musl 版 node-pty
# 用法(目标机, root):
#   git clone --depth 1 https://github.com/Faith-dingx/dsf-work-sync.git
#   sh dsf-work-sync/dsh-archive/node-pty-musl-20260924/apply.sh [dsh根目录, 默认 /srv/dsh]
# 前提: 目标机跑着同系 dsh(自带 node v22, x86_64 + musl); 若架构/arm64 或 glibc 系统, 不适用, 按 README 重编。
set -e
NO_RESTART=0
[ "${1:-}" = "--no-restart" ] && { NO_RESTART=1; shift; }
DROOT="${1:-/srv/dsh}"
HERE=$(dirname "$0")
NP="$DROOT/app/node_modules/node-pty"
[ -d "$NP/prebuilds/linux-x64" ] || { echo "FATAL: $NP/prebuilds/linux-x64 不存在 — dsh 路径不对或该设备 node_modules 布局不同(0.1.4 .pnpm 三处需另拷, 见 README)"; exit 2; }

# 1) 校验本地指纹
M1=$(md5sum "$HERE/pty.node" | cut -d' ' -f1); M2=$(md5sum "$HERE/spawn-helper" | cut -d' ' -f1)
[ "$M1" = "7f67e062f9c7b3af479fac92ebbc594b" ] && [ "$M2" = "88460107dfb0cff1230c8452bb32cb5c" ] \
  || { echo "FATAL: 本地件 md5 不符, 传输损坏"; exit 3; }

# 2) 备份目标机现有 glibc 原件(可逆)
TS=$(date +%Y%m%d-%H%M%S); BAK="$NP/prebuilds/linux-x64/glibc-bak-$TS"
mkdir -p "$BAK"
[ -f "$NP/prebuilds/linux-x64/pty.node" ] && cp -a "$NP/prebuilds/linux-x64/pty.node" "$BAK/" || true
[ -f "$NP/prebuilds/linux-x64/spawn-helper" ] && cp -a "$NP/prebuilds/linux-x64/spawn-helper" "$BAK/" || true

# 3) 部署
cp "$HERE/pty.node" "$NP/prebuilds/linux-x64/pty.node"
cp "$HERE/spawn-helper" "$NP/prebuilds/linux-x64/spawn-helper"
chmod 755 "$NP/prebuilds/linux-x64/spawn-helper"

# 4) 自检: 用目标机 dsh 自带 node 直接 spawn 一次
NODEBIN="$DROOT/node/bin/node"
[ -x "$NODEBIN" ] || NODEBIN=$(command -v node)
echo "deployed, running self-test with $NODEBIN ..."
"$NODEBIN" -e "
const pty=require('$NP');
const p=pty.spawn('/bin/sh',['-c','echo APPLY_SELFTEST_OK'],{cols:80,rows:24});
let o='';p.onData(d=>o+=d);
p.onExit(()=>{process.exit(o.includes('APPLY_SELFTEST_OK')?0:1)});
setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},15000);
" && echo "SELFTEST OK" || { echo "SELFTEST FAIL — 已回滚? 不自动回滚, 备份在 $BAK"; exit 5; }

# 5) 重启 dsh(--no-restart 跳过; 有 procd 服务就重启, 没有就提示)
if [ "$NO_RESTART" = "1" ]; then echo "SKIP restart (--no-restart)";
elif [ -x /etc/init.d/dsh ]; then /etc/init.d/dsh restart && echo "dsh restarted"; else echo "WARN: 无 /etc/init.d/dsh, 请手动重启 dsh 服务"; fi
echo "DONE. 建议核: dmesg | grep -c segfault 计数不增; 3080 探活 200."
