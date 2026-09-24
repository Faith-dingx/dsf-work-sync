# dsh-archive — dsh 本地化重编产物档案（异地直接可用）

本目录存软路由（ImmortalWrt x86_64/musl）上 dsh 服务**本机重编 node-pty（musl 版）**的二进制 + 一键恢复脚本。
其他同类设备整包重装 dsh 后"工具一用就断"（node-pty 被 glibc 预构建件冲掉 → spawn 段错误）时，
**直接取本目录恢复，无需重编**。

## 一键恢复（目标设备, root）
```
git clone --depth 1 https://github.com/Faith-dingx/dsf-work-sync.git
sh dsf-work-sync/dsh-archive/node-pty-musl-20260924/apply.sh [dsh根目录, 默认 /srv/dsh]
```
脚本自带：md5 校验 → 备份目标机 glibc 原件（可回滚）→ 部署 → 目标机 dsh 自带 node spawn 自检 → 重启 dsh。
适用前提：x86_64 + musl（OpenWrt/ImmortalWrt 系）+ dsh 0.1.5 扁平 npm 结构（node-pty 仅 app 顶层 1 处）。
arm64 或 glibc 系统不适用 → 走下方重编配方。

## 兼容性说明（为什么跨设备直接可用）
- pty.node 走 **NAPI 稳定 ABI**（node v22, napi_ver 10），只链接 94 个 `napi_*` 符号（由目标机 node 运行时提供），
  不含 V8 内部符号；musl 静态链接，动态依赖仅 libstdc++.so.6/libgcc_s/libc.musl（OpenWrt 系全有）。
- 已核：二进制内 0 处混入密钥/凭据。
- 版本余量：dsh 后续版本若升级 node-pty/node，按复发判据决定是否沿用；拿不准就重编并更新本目录指纹表。

## 复发判据（目标设备自查）
- `ldd <dsh根>/app/node_modules/node-pty/prebuilds/linux-x64/pty.node` 输出含 `GLIBC`/`GLIBCXX` = glibc 版；
- 或 `node -e "require('<node-pty>')"` 后 `pty.spawn` 段错误（exit=139）、`dmesg | grep segfault` 见 `segfault at 4500`。

## 重编配方（二进制不可用时，g++ 现编）
本机 g++（OpenWrt 13.3.0）+ 头文件（dsh app 内现成）：
- `napi.h` ← `<dsh根>/app/node_modules/node-addon-api/`
- `node_api.h` ← `<dsh根>/app/node_modules/koffi/vendor/node-api-headers/include/`

```
cd <dsh根>/app/node_modules/node-pty
INCS="-I<dsh根>/app/node_modules/node-addon-api -I<dsh根>/app/node_modules/koffi/vendor/node-api-headers/include -I<dsh根>/node/include/node"
g++ -std=c++17 -O2 -fstack-protector-strong -fPIC $INCS -c src/unix/pty.cc -o pty.o
g++ -std=c++17 -O2 -shared -fPIC pty.o -o pty.node
gcc -O2 -c src/unix/spawn-helper.cc -o spawn-helper.o && gcc -O2 spawn-helper.o -o spawn-helper
# musl 不要加 -lpthread
cp pty.node spawn-helper prebuilds/linux-x64/ && chmod 755 prebuilds/linux-x64/spawn-helper
```
0.1.5 扁平 npm 结构仅 app 顶层 1 处；0.1.4 .pnpm 结构需三处（app 顶层/.pnpm patched/profiles，见 dsh 档案/verify-musl-pty 脚本）。
部署前备份 glibc 原件；重启 dsh；`dmesg | grep -c segfault` 计数不增即过。

## 校验指纹
| 版本 | pty.node md5 | spawn-helper md5 | 结构 |
|---|---|---|---|
| 2026-08-28 | b25d67b9d181…（残缺） | — | 0.1.4 .pnpm 三处（存档随 09-24 分区改名被清） |
| **2026-09-24（本目录件）** | 7f67e062f9c7b3af479fac92ebbc594b | 88460107dfb0cff1230c8452bb32cb5c | 0.1.5 单处 |

重编后 md5 会随 g++ 版本/参数漂移（正常）；判"是否 musl 版"看 `ldd` 依赖不锁 md5，但入库/入包前登记新指纹。

## 三层保险（软路由侧）
① 本机 `/srv/dsh/档案/node-pty-musl-20260924/`（自包含铁律）② 每日 dsh-stable 备份包内 `dsh-archive/`
③ 本仓异地（SOP+二进制+一键脚本，跨设备直接可用）。
