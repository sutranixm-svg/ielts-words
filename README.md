# 雅思单词 · IELTS Words

雅思 + 托福词汇卡片应用，共 **9277 词**。除检查更新外全部离线运行。

Android 端是一个 WebView 外壳 + 本地网页（`web/` 目录）。申请三个权限：`INTERNET`（检查更新）、`REQUEST_INSTALL_PACKAGES`（一键更新）、`RECORD_AUDIO`（口语练习录音，只在点录音时请求）；学习数据不上传，全部存在本机。

## 功能

- **发音**：单词卡和测验反馈都能朗读（系统语音引擎，离线可用）
- **四项训练**：口语 Part 2 话题卡 + 计时 + 录音回放、写作 Task 2 话题库 + 句型 + 草稿 + 自查、阅读原创模拟题、同义替换练习
- **模拟考**：20 题 / 15 分钟，交卷给词汇正确率和 Band 粗估
- **备考计划**：设置考试日期，自动算每天该背多少，一键应用
- **词库**：9277 词，8 个板块
  - 自建精编 720 词：教育、环境、健康、社会、科技、工作（每个词带例句）
  - 其余词条配英文释义（ECDICT definition），没有例句时在卡片上显示
  - 雅思词表 4651 词、托福词表 3906 词（音标 + 中文释义）
- **单词卡**：英文、IPA 音标、词性、中文释义、例句
- **学习**：按到期时间生成队列，三档评分（认识 / 模糊 / 不认识）驱动间隔重复
- **学习量可调**：每天新词 5–200，用 −/+ 逐档调；学完配额还能「加练」继续学后面的词
- **错词按艾宾浩斯复习**：1/2/4/7/15/30/60 天间隔，答对推一档、答错回第 1 天；每次最多 20 个，轮流过一遍不重复
- **测验**：拼写填空，干扰项从同话题词里生成
- **今天**：当日学习记录 + 进度环
- **学习范围**：8 个词库可任意勾选，只学选中的；词表不受勾选影响，随时可查
- **词表浏览**：任一词库点进去按字母序浏览，支持英文 / 中文搜索、分页加载
- **外刊精读**：每天 07:00 自动抓 10 篇最新英文报道（科技 / 财经 / 生活 / 文娱），中英对照，点「读原文」跳浏览器
- **更新**：启动时自动检查 GitHub Release，发现新版本在首页弹出提示条，点「一键更新」直接下载并拉起安装器

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

## 外刊精读

`tools/collect_articles.py` 抓取多个媒体的公开 RSS，按分类均衡挑 10 条（科技 / 财经 / 生活 / 文娱），
翻译标题和摘要，写入 `data/articles.json`，App 从 `raw.githubusercontent.com` 拉取并缓存 6 小时。

- **只保存标题 + 摘要 + 链接 + 署名**，不转载全文；正文请点「读原文」到发布方站点阅读
- 翻译走公开翻译端点，失败时保留英文，不会报错中断
- 目前由本机每天 07:00 的定时任务生成并推送（GitHub Actions 版本在 `tools/ci-daily.yml`，
  需要给 token 加 `workflow` 权限才能启用）

## 更新机制

启动 1.5 秒后请求 `https://api.github.com/repos/sutranixm-svg/ielts-words/releases/latest`，
与 `versionName` 比较；有新版本时首页顶部出现提示条，点「一键更新」由原生代码下载 APK
到缓存目录，再通过 `content://` 交给系统安装器（Android 8+ 需允许「安装未知应用」）。

## 说明

- 雅思/托福词表数据来自 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议），按 `ielts` / `toefl` 标签筛选，音标与释义经过程序化整理。
- 720 个精编词的释义与例句为本项目撰写。
- 「雅思 / IELTS」是 British Council、IDP、Cambridge Assessment 的注册商标。本应用与上述机构无关联，也未获其授权；如要上架应用商店，建议改用不含该商标的应用名。
- 当前未在任何应用商店发布，`versionName 1.1` / `versionCode 2`，`targetSdk 33`。上架 Google Play 需 targetSdk 36 且交付 AAB；国内商店需软著与 APP 备案。

## License

代码部分 MIT。词库内容版权归作者所有。
