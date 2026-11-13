#!/bin/sh
# apply-install.sh — 新设备一条命令恢复 dsh 全套本地化改动（相对官方 0.1.5 安装包）
# 前提: 目标机已装官方 0.1.5 安装包(app/node 就位), x86_64 + musl(OpenWrt 系), root 执行
# 用法: sh apply-install.sh [--no-etc] [--no-service-restart] [dsh根目录, 默认 /srv/dsh]
#   --no-etc               跳过 /etc/init.d 部署(演练/目标机服务不归本机管时用)
#   --no-service-restart   跳过服务重启(演练用)
#   HUB_TOKEN_FILE=xxx     可选: 指向中枢 hubv2 data/hub-token 文件, 自动把 init.d 的 token 占位符填实
#   本包布局: home/ config-ui/ system/ ops/ node-pty-musl-20260924/
set -e
HERE=$(dirname "$0")
NO_ETC=0; NO_SVC_RESTART=0
while [ "${1:-}" = "--no-etc" ] || [ "${1:-}" = "--no-service-restart" ]; do
  [ "$1" = "--no-etc" ] && NO_ETC=1; [ "$1" = "--no-service-restart" ] && NO_SVC_RESTART=1; shift
done
DROOT="${1:-/srv/dsh}"
[ -d "$DROOT/app" ] || { echo "FATAL: $DROOT/app 不存在 — 先装官方 0.1.5 安装包"; exit 2; }
mkdir -p "$DROOT/home" "$DROOT/config-ui"   # 目标机官方包缺目录时兜底
echo "target dsh root: $DROOT"

# 1) home 配置层(settings/dsh.env/presets/cordis.patch) — 先备份目标机旧件(若存在)
TS=$(date +%Y%m%d-%H%M%S); BAK="$DROOT/home/.archive-restore-bak-$TS"
for f in settings.yaml dsh.env; do
  [ -e "$DROOT/home/$f" ] && mkdir -p "$BAK/$(dirname $f)" && cp -a "$DROOT/home/$f" "$BAK/$f" 2>/dev/null || true
done
[ -d "$DROOT/home/.agent-presets" ] && cp -a "$DROOT/home/.agent-presets" "$BAK/.agent-presets-$(date +%s)" 2>/dev/null || true
cp -a $HERE/home/settings.yaml $HERE/home/dsh.env "$DROOT/home/"
cp -a $HERE/home/.agent-presets "$DROOT/home/"
mkdir -p "$DROOT/home/profiles/web"
cp -a $HERE/home/profiles/web/cordis.patch.yml "$DROOT/home/profiles/web/"

# 2) config-ui 改造版(keypool 只读版)
mkdir -p "$DROOT/config-ui"
for f in server.js index.html start.sh; do
  [ -e "$DROOT/config-ui/$f" ] && cp -a "$DROOT/config-ui/$f" "$DROOT/config-ui/$f.pre-archive-restore" 2>/dev/null || true
  cp -a "$HERE/config-ui/$f" "$DROOT/config-ui/"
done

# 3) 系统侧 init.d(占位符版本: DSH_HUB_SESSION_TOKEN 需填实; --no-etc 跳过; 有 HUB_TOKEN_FILE 自动填)
if [ "$NO_ETC" = "1" ]; then echo "SKIP /etc/init.d (--no-etc)";
else
  if [ -n "$HUB_TOKEN_FILE" ] && [ -f "$HUB_TOKEN_FILE" ]; then
    HTOK=$(tr -d '\n' < "$HUB_TOKEN_FILE")
    for SRC in $HERE/system/init.d-dsh $HERE/system/init.d-config-ui; do
      DST=/etc/init.d/$(echo "$SRC" | sed 's|.*/init\.d-||')
      [ -f "$SRC" ] || continue
      [ -e "$DST" ] && cp -a "$DST" "$DST.pre-archive-restore" && echo "  [备份] $DST -> $(basename $DST).pre-archive-restore (原有文件将被覆盖!)"
      sed "s|<HUB_TOKEN — 从中枢 hubv2 data/hub-token 取同值>|$HTOK|" "$SRC" > "$DST" && chmod 755 "$DST"
    done
    echo "init.d 部署完成(token 已用 $HUB_TOKEN_FILE 填实)"
  else
    for SRC in $HERE/system/init.d-dsh $HERE/system/init.d-config-ui; do
      [ -f "$SRC" ] || continue
      DST=/etc/init.d/$(echo "$SRC" | sed 's|.*/init\.d-||')
      [ -e "$DST" ] && cp -a "$DST" "$DST.pre-archive-restore" && echo "  [备份] $DST -> $(basename $DST).pre-archive-restore (原有文件将被覆盖!)"
      cp "$SRC" "$DST" && chmod 755 "$DST"
    done
    echo "WARN: 未给 HUB_TOKEN_FILE, init.d 内 DSH_HUB_SESSION_TOKEN 为占位符 — 启动前须人工填目标机中枢 hubv2 data/hub-token 同值"
  fi
fi

# 4) 运维脚本(放目标机 work/bin, 有则放, 无则提示)
if [ -d /mnt/agent/work/bin ]; then
  for f in $HERE/ops/*.sh; do cp -a "$f" /mnt/agent/work/bin/$(basename "$f"); done
  echo "ops scripts -> /mnt/agent/work/bin/"
else
  echo "WARN: 目标机无 /mnt/agent/work/bin, ops 脚本请手工放置并挂 cron"
fi

# 5) musl 原生件(复用同目录 apply.sh, 跳过其重启步, 最后统一重启)
sh "$HERE/node-pty-musl-20260924/apply.sh" --no-restart "$DROOT"

# 6) 启动/重启服务(--no-service-restart 跳过: 演练/已有服务在跑时用)
if [ "$NO_SVC_RESTART" = "1" ]; then echo "SKIP service restart (--no-service-restart)";
else
/etc/init.d/dsh restart 2>/dev/null && echo "dsh restarted" || echo "WARN: dsh 重启失败(未装 init 环境?), 请手动"
[ -x /etc/init.d/config-ui ] && { /etc/init.d/config-ui restart 2>/dev/null && echo "config-ui restarted"; }
fi
echo "=== 收口自检 ==="
echo "3080=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3080/ 2>/dev/null) 3083=$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:3083/api/status 2>/dev/null)"
echo "dmesg segfault 计数(应不增): $(dmesg 2>/dev/null | grep -c segfault)"
echo "密钥: 目标机 key 池需登记 9 个 provider env 键(见 MANIFEST.md 表), 否则模型通道取不到 key"
