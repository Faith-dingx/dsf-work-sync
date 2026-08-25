#!/bin/bash
# dsh 重启脚本（2026-08-20 修复 Bug#2：与 systemd 管理冲突）
# 用法：restart-dsh.sh [延迟秒数]   默认 0 立即重启
#
# 背景：dsh 现在由 systemd user 服务 dsh-web.service 管理（Restart=on-failure、监控面板可见）。
# 旧版用 pkill 杀 dsh 会同时触发 systemd 自动重启 + 脚本自己再 nohup 起一个 → 两个实例抢 3080，
# 且 nohup 实例脱离 systemd 管理。因此现在优先走 systemctl restart；
# 仅当 dsh 不在 systemd 下（历史手动 nohup 实例）才回退到 pkill+nohup。
set -u

DELAY="${1:-0}"
if [ "${DELAY}" -gt 0 ] 2>/dev/null; then
  echo "[restart-dsh] $(date +%H:%M:%S) 延迟 ${DELAY}s 后重启"
  sleep "${DELAY}"
fi

SERVICE="dsh-web.service"

# 判断是否由 systemd 管理
SYSTEMD=0
if systemctl --user list-unit-files "${SERVICE}" >/dev/null 2>&1 && \
   systemctl --user is-active "${SERVICE}" >/dev/null 2>&1; then
  SYSTEMD=1
fi

if [ "${SYSTEMD}" = "1" ]; then
  echo "[restart-dsh] $(date +%H:%M:%S) systemd 管理，执行 systemctl --user restart ${SERVICE}"
  systemctl --user restart "${SERVICE}"
  # 等待 3080 端口就绪（最多 60s）
  for i in $(seq 1 30); do
    if ss -tlnp 2>/dev/null | grep -q ':3080 '; then
      echo "[restart-dsh] $(date +%H:%M:%S) 3080 已就绪"
      exit 0
    fi
    sleep 2
  done
  echo "[restart-dsh] WARN: 60s 内 3080 未就绪，请检查 systemctl --user status ${SERVICE}" >&2
  exit 1
fi

# 回退：非 systemd 管理（手动 nohup 实例）
echo "[restart-dsh] $(date +%H:%M:%S) 非 systemd 管理，回退 pkill+nohup"
pkill -f "apps/cli/src/bin.ts web --host 0.0.0.0 --port 3080" 2>/dev/null
pkill -f "pnpm dsh web --host 0.0.0.0 --port 3080" 2>/dev/null
sleep 3
cd /home/dingx/deepseek-harness
nohup /home/dingx/.hermes/node/bin/pnpm dsh web --host 0.0.0.0 --port 3080 --trusted-host 10.10.10.9 --trusted-host 100.67.219.105 > /home/dingx/DSF-work/.temp/dsh-restart.log 2>&1 &
echo "[restart-dsh] $(date +%H:%M:%S) 已启动 pid $!"
