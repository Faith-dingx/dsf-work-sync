#!/bin/sh
# 模拟 dsh 启动失败：Result=failed + FailureReason + main 进程退出码（真实 systemd 字段）
printf 'Result=failed\nFailureReason=exec of pnpm postinstall failed: ERR_MODULE_NOT_FOUND\nExecMainStatus=1\n'