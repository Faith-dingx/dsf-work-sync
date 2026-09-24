# dsh-archive manifest（2026-09-24，相对官网/官方安装包的全部本地化改动）

## 与官方 0.1.5 安装包的区别（全量盘点对比）
| 层 | 官方态 | 本机态 | 包内件 |
|---|---|---|---|
| app/ | 官方 0.1.5 | **0 改动**（09-23 全新安装，与出厂一致） | 不入包（官方可复现） |
| node/ | 官方 musl node v22.23.2 | 未改 | 不入包 |
| node-pty 原生件 | glibc 预构建（musl 必崩） | musl 重编 7f67e062 | node-pty-musl-20260924/{pty.node,spawn-helper,apply.sh} |
| settings.yaml | 无（官方不随包） | 7 provider 瘦身+contextWindow 512K+默认模型 agnes-plan | home/settings.yaml |
| dsh.env | 无 | TRUSTED_HOSTS+GUARD 两行（0 key） | home/dsh.env |
| .agent-presets | 官方 full 等 | full/full-bot/full-hub（compaction 走 9888 摘要+retainRatio0.24） | home/.agent-presets/ |
| cordis.patch.yml | [] | 本机 [] 同官方（保留位，防未来 patch 丢） | home/profiles/web/cordis.patch.yml |
| config-ui | 官方零依赖版 | **keypool 改造**（/api/keys 只读 boxinfo.db、3处写 key 拦截、JS_YAML_PATH） | config-ui/server.js,index.html,start.sh |
| init.d | 无（官方无服务化） | procd 双服务+keypool env 逐键注入+DNAT 补开+无限重试 | system/init.d-dsh, init.d-config-ui |
| 运维脚本 | 无 | 每日备份(含档案)/会话保留/观察提醒 | ops/ |
| 密钥 | — | **全走 key 池 boxinfo.db，包内 0 真值** | 无 |
| 凭据 .credentials.yaml | — | refs 结构本机专属（含密钥） | **不入包**，新设备从 key 池生成 |

## 一键安装（新设备，root）
```
git clone --depth 1 https://github.com/Faith-dingx/dsf-work-sync.git
sh dsf-work-sync/dsh-archive/apply-install.sh [dsh根目录, 默认 /srv/dsh]
```
脚本自动：备份目标机旧件 → 部署 home 配置层+presets+cordis.patch → config-ui 改造版 →
init.d（覆盖前自动备份 .pre-archive-restore）→ ops 脚本 → 复用 node-pty apply.sh
（--no-restart 走全量部署）→ 统一重启 dsh/config-ui → 3080/3083 探活 + dmesg 段错误自检。

参数（演练/特殊场景）：
- `--no-etc`：跳过 /etc/init.d 部署（不碰目标机系统服务件）；
- `--no-service-restart`：跳过服务重启；
- `HUB_TOKEN_FILE=<目标机中枢 hubv2 data/hub-token 路径>`：自动把 init.d 的 DSH_HUB_SESSION_TOKEN
  占位符填实；不给则保持占位符并提示人工填。
前提：目标机已装官方 0.1.5 安装包（app/node 就位）+ x86_64/musl + root；key 池需先登记 9 个 provider env 键。
演练已核（2026-09-24 假根全流程）：--no-etc --no-service-restart 下生产 /etc/init.d 与 dsh 服务零影响。

## 包内件清单（2026-09-24）
```
dsh-archive/
├ MANIFEST.md                      本文件（全量对比+安装流程）
├ apply-install.sh                 一键安装脚本（新设备全恢复入口）
├ home/
│  ├ settings.yaml                7 provider 瘦身+contextWindow 512K+默认 agnes-plan（无密钥）
│  ├ dsh.env                      TRUSTED_HOSTS+GUARD（0 key）
│  ├ .agent-presets/{full,full-bot,full-hub}/  活件（已清 .bak 历史）
│  └ profiles/web/cordis.patch.yml
├ config-ui/{server.js,index.html,start.sh}   keypool 只读改造版（读 boxinfo.db 非明文）
├ system/{init.d-dsh,init.d-config-ui}        procd 双服务（DSH_HUB_SESSION_TOKEN 占位化）
├ ops/{dsh-backup.sh,dsh_sessions_retention.sh,dsh-observe-reminder.sh}
└ node-pty-musl-20260924/{pty.node,spawn-helper,apply.sh,README.md}   musl 原生件+单件修复
```
**不入包**（本机专属/含密钥）：app/（官方可复现，0 改动）、node/、`.credentials.yaml`（refs 含密钥）、
`.config-ui-token`、`.anonymous-user-id`、sessions/storages/memory 数据类。
