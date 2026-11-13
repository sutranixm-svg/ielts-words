# 发布

版本号以 `android/AndroidManifest.xml` 为准。打 tag 之前先改 `versionName` 和 `versionCode`：`versionName` 必须等于 tag（去掉前缀 `v`），`versionCode` 必须大于上一个 tag 里的值。

当前仓库版本是 **1.9.4**（`versionCode` 16）。本地如果还有没推上来的 1.9.x 改动，先合进这份清单再打 tag，否则流水线会按 GitHub 上的 manifest 出包。

## 需要的 GitHub Actions secrets

在仓库 Settings → Secrets and variables → Actions 里添加。缺任何一个，`release.yml` 会在编译前失败，不会自动生成密钥。

| Secret | 内容 |
| --- | --- |
| `KEYSTORE_BASE64` | 发布用 `.jks` 的 base64。`base64 -w 0 release.jks`（macOS 用 `base64 < release.jks`） |
| `KEYSTORE_PASSWORD` | keystore 口令 |
| `KEY_ALIAS` | 密钥别名。现有证书的别名是 `ielts` |
| `KEY_PASSWORD` | 密钥口令。如果和 keystore 口令相同，也要单独填一份 |

签名证书的 SHA-256 必须是：

```
4A:DF:68:0B:A5:59:E1:AA:B0:79:17:0A:0E:95:5E:62:93:DC:EA:73:DE:B9:A2:60:0D:84:F5:9B:26:03:E9:AA
```

对不上时流水线会失败，不会发 Release。不要把 keystore、口令或 `.env` 提交进仓库。

## 打开发布

1. 确认 `main` 上的 `versionName` / `versionCode` 已经是要发的版本。
2. 合并本 PR（或把包含 manifest 的提交推进 `main`）。
3. 在 `main` 上打 tag 并推送。tag 才会触发发布，普通 push 和 PR 不会。

```bash
git checkout main
git pull
git tag v1.9.4
git push origin v1.9.4
```

流水线会：

- 用 Ubuntu 上的 JDK 17 和 Android SDK 35 编译
- 用上面的 secrets 签名，口令只走环境变量
- 核对证书指纹，并确认 `versionCode` 比上一个 `v*` tag 大
- 创建**非草稿、非预发布**的 GitHub Release，附件名为 `ielts-vocab-<versionName>.apk`
- 把同一份 APK 和生成的 `version.json` 推到 `dist` 分支（只追加这两个文件，不会把 `main` 合并进 `dist`）

`version.json` 字段：`version`、`versionCode`、`size`、`sha256`、`urls`。

## 本地编译

发布密钥不在这台机器上时，可以编一个未签名包做检查：

```bash
export ANDROID_SDK_ROOT="$HOME/android-sdk"   # 按自己的 SDK 位置
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
SIGN=0 bash build.sh
```

要签成本机调试包，自己准备一个**不入库**的 keystore，再设置 `KEYSTORE`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。`build.sh` 不会在找不到密钥时新建一把。

脚本会找 `ANDROID_SDK_ROOT`（或 `ANDROID_HOME`）里的 `android.jar` 和 build-tools。dex 优先用 `d8`，没有才用 `dx`。资源里的 `.mp3` 保持不压缩（ZIP method STORED）。
