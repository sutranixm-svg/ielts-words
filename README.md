# 雅思单词

离线为主的雅思 / 托福词汇应用，词库 **9277**。Android 端是 WebView 外壳，界面在 `web/`。

当前版本 **1.9.4**（`versionCode` 16，`targetSdk` 35）。除检查更新、外刊和可选的联网发音外，学习过程不上传。

## 功能

- **首页**：今日目标、连续天数、待复习、词汇书和本周柱状图。
- **学习**：新词先走精编 720，再按雅思词表往下排。也可以自己勾选词库。
- **复习**：FSRS 安排下次出现的时间。忘记 / 模糊 / 认识（还可以标「太简单了」）写进同一条记忆记录，测验和错词本也用它。
- **练习**：四选一还在。另外可以听写、看中文拼单词、在例句里填空。
- **本周薄弱**：错误分成拼写、词义、再认。同一词一周里错到两次，会自动排进今天。
- **听说读写**：口语话题卡、写作草稿和自查（中英文字数分开计）、阅读模拟和点词查义。
- **外刊**：拉取中英对照摘要，数独和填字不会进列表。
- **我的**：每天新词、复习上限、主题、导出 / 导入 JSON、最近 7 天本地备份。

底部四个标签：首页、学习、复习、我的。

## 发音

720 个精编词带离线 mp3。没有录音的词可以打开「联网补全」，音频来自有道词典的公开接口；关掉就用系统语音合成。打包时这些 mp3 保持不压缩。

## 安装

从 [Releases](../../releases) 下载 `ielts-vocab-<版本>.apk`。Android 6.0 及以上。安装器需要「安装未知应用」权限。

## 构建

发布步骤、需要的 GitHub secrets 和证书指纹写在 [RELEASE.md](RELEASE.md)。`build.sh` **不会**自动生成 keystore，口令只从环境变量读，不会出现在命令行参数里。

本机只想确认能编过：

```bash
export ANDROID_SDK_ROOT=...   # 需要 platforms 和 build-tools，优先用 d8
export JAVA_HOME=...
SIGN=0 bash build.sh          # build/ielts-vocab-<versionName>.apk，未签名
```

要签成可以安装的包，自己提供 `KEYSTORE`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`。不要把密钥或 `.env` 提交进仓库。

## 数据

学习记录存在本机 `localStorage` 的 `ielts.vocab.v2`。旧的 `ielts.vocab.v1` 会在打开时迁过来。系统的 `allowBackup` 是关的，避免整包备份把进度带走；换机用应用里的 JSON 导出。

## 目录

```
android/      Manifest、WebView 外壳、更新下载
web/          界面、词库、FSRS、离线发音
data/         外刊摘要
tools/        词库整理、外刊采集
test/         界面和算法测试（Node）
.github/      打 tag 发布、每日外刊
```

## 测试

```bash
npm install --prefix test
node test/ui-test.cjs
node test/study-test.cjs
node test/deck-test.cjs
node test/update-test.cjs
node test/storage-test.cjs
node test/fsrs-test.cjs
node test/learn-test.cjs
node test/news-test.cjs
node test/train-test.cjs
node test/extra-test.cjs
```

## 词库说明

雅思 / 托福词表来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT），按标签筛选。精编 720 的释义和例句是这个项目写的。缺音标、缺例句的清单在 [CONTENT_GAPS.md](CONTENT_GAPS.md)，脚本没有编造补齐。

「雅思 / IELTS」是 British Council、IDP、Cambridge Assessment 的注册商标。本应用与这些机构无关。

## License

代码部分 MIT。词库内容版权归作者所有。
