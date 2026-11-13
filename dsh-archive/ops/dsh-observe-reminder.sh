#!/bin/sh
# DSH 平台观察提醒（08:25，随DSH平台同进退）：记录 dsh/home/sessions 体积涨幅
# 2026-09-24 按定案拆分归位：原 observe-reminder.sh 中 DSH 部分移此，落 /mnt/agent/dsh/work/bin/
LOG=/mnt/agent/共享/待办/清理观察-提醒.log
echo "[$(date +%F_%H:%M)] dsh_sessions=$(du -sk /mnt/agent/dsh/home/sessions 2>/dev/null | cut -f1)KB" >> "$LOG"
