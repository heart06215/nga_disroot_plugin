# NGAExt iOS（越狱 tweak，未实机验证）

把 NGA iOS 帖子里的 disroot / paste.to PrivateBin 外链在本地解密，并把正文卡片插到楼层下方。

> 状态：**工程骨架 + 可测试的 PrivateBin 解密核心**。当前环境是 Windows，没有 macOS/Theos/iOS SDK，也没有越狱设备，因此 **Tweak 本身没有编译和实机验证过**。JS 侧的 PrivateBin 解密已在 Node（WebCrypto + DecompressionStream）用真实的 `paste.to` 链接验证通过。

## 结构

```
Tweak.xm                  hook WKWebView，注入 JS、注册 message handler
NgaExtBridge.h/.m         原生抓取密文（绕过 CORS），把 JSON 回传给 JS
ngaext.js                 扫描楼层、密码记忆、卡片 UI、WebCrypto 解密
NgaExt.plist              Theos 注入过滤（需要填真实 NGA bundle id）
Makefile / control        Theos 工程
layout/...                打包时放入设备的 ngaext.js
```

## 工作方式

1. Hook `WKWebView -initWithFrame:configuration:`，在页面加载前把 `ngaext.js` 作为 `WKUserScript` 注入，并注册 `window.webkit.messageHandlers.ngaext`。
2. JS 扫描 `.columnItem` / `.articleBlock`，识别 disroot（bin/paste）和 `paste.to` 的 `?id#key` 指纹。
3. JS 通过 message handler 把 URL 交给原生；原生用 `NSURLSession` 抓取 PrivateBin JSON（带 `X-Requested-With: JSONHttpRequest`），避开网页 CORS。
4. JS 用 WebCrypto 做 PBKDF2-SHA256 + AES-256-GCM，按 43–46 字符密钥长度候选和密码候选尝试解密；`DecompressionStream('deflate-raw')` 解压。
5. 解密结果显示为卡片，支持展开全文、复制、原链、夜间模式、按帖子隔离的密码记忆。

## 前置条件

- macOS + [Theos](https://theos.dev) + iOS SDK
- 越狱设备（rootful 或 rootless 均可；rootless 用 `THEOS_PACKAGE_SCHEME=rootless`）
- iOS 15+；`zlib` 压密的帖需要 iOS 16.4+（`DecompressionStream`）
- 已安装 NGA iOS 客户端

## 必须修改的配置

### 1. NGA iOS 的 bundle id

`NgaExt.plist` 里目前是猜测值。用以下任一方式取真实 bundle id：

- `frida-ps -Uai | grep -i nga`
- 越狱设备上用 Filza 看 `/var/containers/Bundle/Application/*/NGA.app/Info.plist` 的 `CFBundleIdentifier`
- `plutil -p .../Info.plist | grep CFBundleIdentifier`

把结果写进 `NgaExt.plist` 的 `Bundles`。如果 bundle id 不对，tweak 不会加载。

### 2. 进程名

`Makefile` 的 `INSTALL_TARGET_PROCESSES = NGA` 需要与 NGA 的可执行文件名一致（通常就是 `NGA`）。只影响 `make install` 后自动重启进程，不影响注入过滤。

## 构建

```bash
export THEOS=~/theos
cd ios-tweak

# rootless（Dopamine / palera1n rootless 等）
make clean package THEOS_PACKAGE_SCHEME=rootless

# rootful
make clean package
```

产物在 `packages/`。安装：

```bash
make install          # 需要 usbmuxd/ssh 连接设备
# 或
dpkg -i packages/com.ngaext.ios_0.1.0_iphoneos-arm64.deb
```

rootless 的安装路径会自动落在 `/var/jb`；`Tweak.xm` 会先读 `/var/jb/Library/Application Support/NgaExt/ngaext.js`，再读 `/Library/...`。

## 验证清单（上机后）

1. `Console`/`idevicesyslog` 过滤 `[ngaext]`，确认 JS 加载、无 `setup failed`。
2. 打开有 `paste.to` 链接的帖子（例如第 4 帖第 1 页），应出现「已本地解密」卡片。
3. 打开 disroot 链接：服务器恢复后应成功；当前 disroot 故障时会显示维护提示。
4. 翻页后检查密码记忆是否仍按同一帖子生效（`threadKey` 依赖首楼 `doAction(304,...)`，如果 iOS DOM 不同需要调整）。
5. 检查夜间模式、复制、原链、展开全文。

## 已知限制

- **未实机验证**：Theos 工程、WKWebView hook、NGA iOS 的 DOM 结构都需要在 Mac/设备上联调。
- 只 hook `WKWebView`；如果 NGA iOS 用 `UIWebView` 或原生渲染，本方案无效。
- 只覆盖 NGA 主 App 进程；分享扩展/Widget 不在过滤范围。
- iOS 16.4 以下没有 `DecompressionStream`，zlib 压缩的帖子会解密失败；需要补一个纯 JS inflate（如 pako）。
- 目前 host 白名单是 `*.disroot.org` 和 `paste.to`；其他 PrivateBin 实例需要在 `NgaExtBridge.m` 和 `ngaext.js` 同时加白名单。
- NGA iOS 的楼层 DOM 若与 Android 不同（不是 `.columnItem`/`.articleBlock`），需要改 `ngaext.js` 的 `scan()` 选择器。
- 原生只抓密文，不做解密；密码/密钥不会离开设备，也不会上传。

## JS 核心的离线验证

`ngaext.js` 的 `PrivateBin.decrypt` 已在 Node 24 下用真实 `paste.to` 数据验证：

```
ok: true, chars: 2381, domain: paste.to
```

说明 44 字符密钥、AAD 截取（`adata` 后紧跟 `v/ct/meta` 的情况）和 AES-GCM/PBKDF2 逻辑是正确的；未覆盖的只是 WKWebView 注入与 iOS DOM。
