#!/bin/sh
printf '%s\n' \
  'Aug 24 14:37:08 host dsh-web[123]: node:internal/modules/run_main:351: Error [ERR_MODULE_NOT_FOUND]: Cannot find module /home/dingx/deepseek-harness/scripts/x' \
  'Aug 24 14:37:08 host dsh-web[123]: Job for dsh-web.service failed because the control process exited with error code.' \
  'Aug 24 14:37:08 host dsh-web[123]: node:internal/modules/run_main:351: Crash while running postinstall script'
# 记录 journalctl 被调用（测试通过 DSH_JOURNAL_ARGS 注入标记路径）
[ -n "$JOURNAL_MARKER" ] && touch "$JOURNAL_MARKER"