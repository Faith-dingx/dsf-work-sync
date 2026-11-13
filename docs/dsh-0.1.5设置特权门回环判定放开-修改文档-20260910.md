# dsh 0.1.5 设置特权门"非回环浏览器降级"放开 —— 修改文档（2026-09-10）

## 一、背景与根因

- 现象：经 3081（dsh-pocket 代理，局域网地址 10.10.10.2:3081）打开 Web GUI，模型页报 "settings are unavailable in this browser"、插件配置页不可见、VR 设置页报错；SSH 隧道 127.0.0.1:3080 一切正常。
- 根因（check-agent 定案，置信度 95%）：0.1.5 客户端设置镜像按浏览器地址栏判定——
  `packages/client/ui-settings/src/client/index.ts:58`
  `const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'`
  非回环 → memory 终态 → settings/describe 请求**客户端根本不发出**（settings-mirror.ts:114-137），并连带插件 tab 隐藏（ui-settings-plugins/src/client/tab-store.ts:87-89）。
- 服务端 PRIVILEGED_METHODS 围栏（connection/src/index.ts:97-176）本就放行"受信地址+已认证"请求（实测局域网 Host 均 401 放行到登录层），客户端这道门是**重复且更严**的限制。

## 二、修改点（1 个文件、1 行）

**文件**：`/home/dingx/deepseek-harness/packages/client/ui-settings/src/client/index.ts`
**第 58 行**

- 改前：`  const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'`
- 改后：`  const persistence = 'host' // [dsh-lan-settings-fix 20260910] 放开客户端回环门：特权面由服务端 PRIVILEGED_METHODS 围栏（trusted-host + 认证）把守，行为对齐 0.1.1`

## 三、备份

改前复制：`/home/dingx/deepseek-harness/packages/client/ui-settings/src/client/index.ts` → 同目录 `index.ts.bak-lan-settings-20260910`

## 四、生效步骤

1. code-agent 完成修改后执行主仓 `pnpm build`（网页端为预构建产物，必须重建）
2. 用户手动重启 dsh-web（重启是用户专属操作）

## 五、回滚（不行就回滚，两步）

1. `cp /home/dingx/deepseek-harness/packages/client/ui-settings/src/client/index.ts.bak-lan-settings-20260910 /home/dingx/deepseek-harness/packages/client/ui-settings/src/client/index.ts`
2. 主仓 `pnpm build`，用户再重启 dsh-web

## 六、风险与边界

- 安全边界变化：任何能达服务器的浏览器（含未受信地址）都会尝试发 settings 请求；未受信地址会被服务端围栏 403 拒绝（明确报错而非静默降级），已认证+受信地址可用——等同 0.1.1 时代行为。
- 升级冲突面：该文件此前无我们的改动（干净）；上游升级若改动此行需人工重新适配（预期每次几分钟）。
- VR 设置页报错是独立线（其通道热修曾被 2.1.5 升级覆盖），本次修改后若仍报错另行处理。

## 七、验收清单（重启后）

1. 10.10.10.2:3081 打开 → 模型页提供方目录正常加载，无 "settings are unavailable"
2. 插件配置页可见
3. Vision Router 设置页可读（若仍报错转独立线）
4. 127.0.0.1:3080 原路径回归无异常
5. 手机端（非受信路径）行为：聊天等普通功能不受影响

## 八、验收结果（2026-09-10 深夜，用户实测通过 ✅）

- 10.10.10.2:3081：模型提供方目录正常加载，"settings are unavailable" 消失，插件配置页可见 ✅
- 127.0.0.1:3080：同步恢复正常（此前插件部分未透过的问题一并消除）✅
- 验收通过，补丁保留。回滚备份 index.ts.bak-lan-settings-20260910 保留至下次升级确认无冲突后再清。

## 九、重要教训：陈旧构建残渣（用户指令：以后任何工作不得留垃圾）

- 事故：上游 commit 4553c9d957 删除 SQLite 持久化后端时，只删了 git 跟踪的源码，**gitignored 的 lib/ 产物残留在主检出**（10 个孤儿包壳 + 158 个旧布局目录，共 168 条），导致 pnpm build 报 4 个 MISSING_EXPORT。
- 危害：①构建失败掩盖真实改动效果 ②陈旧产物可能被服务端加载造成"改了没生效"的假象（本次即因此多排一轮）。
- 规矩（长期遵守）：**任何删除包/重构/升级操作，必须同步清理其 gitignored 构建产物；每次收工清点自己产生的临时文件与产物；测试产物进 .temp/ 且用完即清**。清查方法：lib/dist 时间戳 vs git 跟踪状态 vs workspace 依赖图三方核对。
