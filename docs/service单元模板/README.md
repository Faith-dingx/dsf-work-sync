# systemd 用户单元模板（迁移用）

> 来源：本机 `~/.config/systemd/user/` 两个运行中单元（dsh-web / config-ui），
> 2026-08-25 模板化存档。**仅用于迁移到新机器时参考/替换，本机运行单元不受影响。**

## 占位符

| 占位符                 | 含义                          | 示例值                                                       |
| ---------------------- | ----------------------------- | ------------------------------------------------------------ |
| 双花括号 HOME          | 新机器用户 HOME 目录          | `/home/router`                                               |
| 双花括号 HARNESS_DIR   | deepseek-harness 仓库绝对路径 | `/home/router/deepseek-harness`                              |
| 双花括号 WORKSPACE     | DSF-work 工作区绝对路径       | `/home/router/DSF-work`                                      |
| 双花括号 TRUSTED_HOSTS | dsh web 可信主机 IP（可多个） | `10.10.10.10` 或 `10.10.10.10 --trusted-host 100.67.219.105` |

## 迁移用法（在新机器上）

1. 把两个 `.template` 复制为新机器的单元文件：
   ```bash
   cp dsh-web.service.template   ~/.config/systemd/user/dsh-web.service
   cp config-ui.service.template ~/.config/systemd/user/config-ui.service
   ```
2. 用 sed 一次性替换占位符（去掉注释后再执行；双花括号按字面写，sed 分隔符避免与 `{{` 冲突用 `|`）：
   ```bash
   NEW_HOME=/home/router
   NEW_WS=/home/router/DSF-work
   NEW_HARNESS=/home/router/deepseek-harness
   NEW_IP=10.10.10.10
   for f in ~/.config/systemd/user/dsh-web.service ~/.config/systemd/user/config-ui.service; do
     sed -i \
       -e "s|{{HOME}}|$NEW_HOME|g" \
       -e "s|{{HARNESS_DIR}}|$NEW_HARNESS|g" \
       -e "s|{{WORKSPACE}}|$NEW_WS|g" \
       -e "s|{{TRUSTED_HOSTS}}|$NEW_IP|g" \
       "$f"
   done
   ```
   > 多个可信 IP 时，把 `{{TRUSTED_HOSTS}}` 填成 `10.10.10.10 --trusted-host 100.67.219.105`
   > （占位符只出现一次，值内可含第二个 `--trusted-host`）。
3. 重新加载并启用（**迁移时用户操作，本机不要执行**）：
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now dsh-web.service config-ui.service
   ```

## 与适配脚本的关系

`scripts/adapt-machine-paths.sh`（1a 交付）的 ② 功能会直接读取本机运行单元生成
"新版片段"（已替换 HOME/路径/IP），比手工 sed 更省事；本模板是给**无脚本环境**
或需要手工核对时的备份参照。两者路径/IP 语义一致。

## 本机基线（勿改动）

本机当前运行单元（未模板化版本）位于 `~/.config/systemd/user/`，含硬编码：

- dsh-web 的 `--trusted-host 10.10.10.9 --trusted-host 100.67.219.105`
- 两者 `/home/dingx/...` 路径
  迁移前请先跑 `scripts/adapt-machine-paths.sh --dry-run` 预览再执行。
