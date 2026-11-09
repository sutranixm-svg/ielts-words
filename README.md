# 雅思单词 · IELTS Words

一个完全离线的雅思词汇卡片应用。720 个学术词汇，按话题分组，带间隔重复、拼写测验和每日进度环。

Android 端是一个 WebView 外壳 + 本地网页（`web/` 目录），**不申请任何权限**，包括网络权限——装好之后断网也照常使用。

## 功能

- **词库**：720 词，6 个话题——教育、环境、健康、社会、科技、工作
- **单词卡**：英文、IPA 音标、词性、中文释义、例句
- **学习**：按到期时间生成队列，三档评分（认识 / 模糊 / 不认识）驱动间隔重复
- **测验**：拼写填空，干扰项从同话题词里生成
- **今天**：当日学习记录 + 进度环
- **词库**：按话题浏览、查看掌握状态

四个标签页：`今天` / `学习` / `测验` / `词库`。

## 安装

从 [Releases](../../releases) 下载 APK，安装时允许「未知来源」即可。要求 Android 6.0（API 23）以上。

## 构建

需要 JDK + Android SDK（`aapt`、`dx`、`zipalign`、`apksigner`）。

```bash
cp .env.example .env     # 填入 KS_PASS（签名口令）
bash build.sh            # 产出 build/ielts-vocab.apk
```

签名口令只从环境变量或 `.env` 读取，**不入库**。`build/`、`.keystore/`、`.env` 都已在 `.gitignore` 中排除。

## 目录

```
android/      AndroidManifest + MainActivity（WebView 外壳）
web/          应用本体：index.html / app.js / style.css / words.js
avatar/       角色形象素材
test/         UI 冒烟测试（Node）
build.sh      手工打包脚本
```

## 说明

- 词库为自建内容，例句为本项目撰写。
- 「雅思 / IELTS」是 British Council、IDP、Cambridge Assessment 的注册商标。本应用与上述机构无关联，也未获其授权；如要上架应用商店，建议改用不含该商标的应用名。
- 当前未在任何应用商店发布，`versionName 1.1` / `versionCode 2`，`targetSdk 33`。上架 Google Play 需 targetSdk 36 且交付 AAB；国内商店需软著与 APP 备案。

## License

代码部分 MIT。词库内容版权归作者所有。
