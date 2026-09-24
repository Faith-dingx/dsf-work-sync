#!/bin/sh
# config-ui 启动脚本（环境变量集中此处；init.d 调用本脚本）
export CONFIG_DIR=/srv/dsh/home
export PRESETS_DIR=/srv/dsh/home/.agent-presets
export HOME=/
export HOST=0.0.0.0
export JS_YAML_PATH=/mnt/agent/dsh/app/node_modules/js-yaml
cd /mnt/agent/dsh/config-ui
exec /srv/dsh/node/bin/node server.js
