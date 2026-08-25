#!/bin/sh
# 超长错误输出：1000 字符的 "errorerror..." 行，验证 500 字符截断
printf 'error%.0s' $(seq 1 200)
printf '\n'