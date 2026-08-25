#!/bin/sh
# 模拟 dsh 启动失败但 FailureReason 为空：只有 ExecMainStatus 可作错误依据
printf 'Result=failed\nFailureReason=\nExecMainStatus=1\n'