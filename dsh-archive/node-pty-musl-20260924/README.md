# dsh-archive — dsh 本地化重编产物档案（异地）

本目录存软路由（ImmortalWrt）上 dsh 服务**本机重编原生模块**的档案与恢复 SOP。
**口径：二进制件不入本仓（public 仓不放编译产物）**——真件在软路由
`/srv/dsh/档案/node-pty-musl-20260924/`（自包含铁律：dsh 档案归 dsh 根级）
+ 每日 dsh-stable 备份包内 `dsh-archive/`；本仓只做异地 SOP 与校验指纹，
拔盘/重装后按本文重建即可，无需取回旧二进制。

## node-pty musl 版（node-pty@1.2.0-beta.15）

dsh 的 bash 工具链底层是 node-pty；官方预构建只有 glibc 版，musl 软路由加载即段错误
（"工具一用就断"根因）。必须本机重编 musl 版。

### 复发判据（整包重装/还原 node_modules 后 100% 出现）
- `ldd /srv/dsh/app/node_modules/node-pty/prebuilds/linux-x64/pty.node` 输出含 `GLIBC`/`GLIBCXX`
  = glibc 版冲掉了 musl 版；
- 或 `node -e "require('node-pty')"` 后 `pty.spawn` 段错误（exit=139）、
  `dmesg | grep segfault` 见 `node[...] segfault at 4500`。

### 重编配方（g++ 现编，无需 node-gyp）
本机 g++（OpenWrt 13.3.0）+ 头文件（app 内现成）：
- `napi.h` ← `/srv/dsh/app/node_modules/node-addon-api/`
- `node_api.h` ← `/srv/dsh/app/node_modules/koffi/vendor/node-api-headers/include/`

```
cd /srv/dsh/app/node_modules/node-pty
INCS="-I.../node-addon-api -I.../koffi/vendor/node-api-headers/include -I/srv/dsh/node/include/node"
g++ -std=c++17 -O2 -fstack-protector-strong -fPIC $INCS -c src/unix/pty.cc -o pty.o
g++ -std=c++17 -O2 -shared -fPIC pty.o -o pty.node
gcc -O2 -c src/unix/spawn-helper.cc -o spawn-helper.o && gcc -O2 spawn-helper.o -o spawn-helper
# musl 不要加 -lpthread
cp pty.node spawn-helper prebuilds/linux-x64/ && chmod 755 prebuilds/linux-x64/spawn-helper
```
0.1.5 扁平 npm 结构仅 app 顶层 1 处；0.1.4 .pnpm 结构需三处（app 顶层/.pnpm patched/profiles）。
部署前 `cp -a` 备份 glibc 原件；`/etc/init.d/dsh restart`；`dmesg | grep -c segfault` 计数不增即过。

### 校验指纹（历史重编版）
| 版本 | pty.node md5 | 结构 | 备注 |
|---|---|---|---|
| 2026-08-28 | b25d67b9d181… | 0.1.4 .pnpm 三处 | 存档随 09-24 分区改名被清 |
| 2026-09-24 | 7f67e062f9c7b3af479fac92ebbc594b | 0.1.5 单处 | spawn-helper=88460107dfb0cff1230c8452bb32cb5c |

每次重编后以新 md5 登记进上表（重编产物内容随 g++ 版本/优化参数漂移，md5 会变，属正常；
判"是否 musl 版"看 `ldd` 依赖，不锁 md5）。
