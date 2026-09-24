#!/bin/sh
# D端会话保留策略(2026-09-12 user定案): >30天会话文件删除, 流水账留痕
LOG=/mnt/agent/共享/待办/dsh-sessions-清理.log
LIST=$(find /srv/dsh/home/sessions -type f -mtime +30 ! -name 'query.sqlite')
N=$(echo "$LIST" | grep -c . 2>/dev/null || true)
S=$(echo "$LIST" | xargs -r du -ck 2>/dev/null | tail -1 | cut -f1)
[ -n "$LIST" ] && echo "$LIST" | xargs rm -f
echo "[$(date +%F_%H:%M)] 清理>30天会话文件 ${N:-0}个 ${S:-0}KB" >> "$LOG"
