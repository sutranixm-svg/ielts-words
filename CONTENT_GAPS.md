# 词库缺口

生成脚本：`node tools/enrich_lexicon.js`。只从现有词条推导，不新写例句或释义。

推荐路径另有 `python3 tools/build_path_data.py ecdict.csv`。它只做两件事：给 Coxhead 学术词表的词族挂上词库里已经有的词，以及从 ECDICT（MIT）抄 `gk` / `cet4` 标签和已有释义。不新写例句。

## 推荐路径用了哪些词表

- **学术词表 AWL**：570 个词族、10 个 Sublist。词族来自 `data/awl.json`，那是 [machine_readable_wordlists](https://github.com/lpmi-13/machine_readable_wordlists) 的 CC0 转写，对应 Victoria University of Wellington 公布的 Coxhead Academic Word List。每个词族都在现有词库或 ECDICT 里找到了可学习的词，没有编释义。Sublist 内按字母序编号。
- **高中词汇**：ECDICT 的 `gk`（高考）标签，3669 词。这不是某一本「高中 3500」书的逐条复印。
- **四级词汇**：ECDICT 的 `cet4` 标签，3847 词。
- **听力答案词、复盘生词**：应用里由用户自己添加，不内置词表。

## 没有放进来的词表

- **538 学术核心词**：没有找到可以随应用分发的公开词表。阶段 3 仍然留在路径里，听力答案词和复盘生词也还在。没有导入《雅思词汇真经》或其他教辅书的词表。

## 已补上

- 拼写变体和连字符音标（指向词表里已有的音标）：6
- 规则复数音标（词根音标 + /s/、/z/ 或 /ɪz/）：182
- 从精编例句里抽出的搭配：562 个词
- 易混词：词表里同时存在的固定对照，以及英美拼写对照

### 拼写变体

- wellbeing ← well-being
- co-operation ← cooperation
- cosy ← cozy
- distil ← distill
- theatre ← theater
- thousand-fold ← thousandfold

## 仍然没有音标（148）

这些词在词表里没有可对照的词根或拼写变体，脚本没有猜。

- `marginalise`（society）
- `accompanying`（toefl）
- `account for`（ielts）
- `advantages`（ielts）
- `adversely`（toefl）
- `aggressiveness`（toefl）
- `approaching`（toefl）
- `astonished`（toefl）
- `asymmetrical`（toefl）
- `automated`（toefl）
- `avocational`（toefl）
- `awkwardly`（toefl）
- `axe`（toefl）
- `baby-sitter`（toefl）
- `barrenness`（toefl）
- `beds`（ielts）
- `beginners`（ielts）
- `birds`（ielts）
- `bring about`（ielts）
- `brothers`（ielts）
- `cd`（ielts）
- `cheaper`（ielts）
- `cometary`（toefl）
- `committed`（toefl）
- `competing`（toefl）
- `consciously`（toefl）
- `consistently`（toefl）
- `coordinated`（toefl）
- `courteously`（toefl）
- `despoiler`（toefl）
- `diligently`（toefl）
- `dishes`（ielts）
- `doors`（ielts）
- `drinks`（ielts）
- `drugs`（ielts）
- `eclat`（toefl）
- `entrenched`（toefl）
- `ethically`（toefl）
- `exceptionally`（toefl）
- `expenses`（ielts）
- `eye-catching`（toefl）
- `facelift`（toefl）
- `far-reaching`（toefl）
- `farmers`（ielts）
- `filmed`（ielts）
- `fingers`（ielts）
- `fleeting`（ielts）
- `fruitfulness`（toefl）
- `fruitlessly`（toefl）
- `full-time`（ielts）
- `fund-raising`（ielts）
- `genetically`（toefl）
- `girlfriend`（ielts）
- `hard-working`（ielts）
- `high-rise`（ielts）
- `in spite of`（toefl）
- `indefinitely`（toefl）
- `inextricably`（toefl）
- `instinctively`（toefl）
- `intentionally`（toefl）
- `irregularly`（toefl）
- `kids`（ielts）
- `laboriously`（toefl）
- `larvae`（toefl）
- `lions`（ielts）
- `long-range`（toefl）
- `lyrically`（toefl）
- `marks`（ielts）
- `mechanized`（toefl）
- `meticulously`（toefl）
- `miles`（ielts）
- `multistory`（toefl）
- `muscles`（ielts）
- `narrator`（ielts）
- `notoriously`（toefl）
- `obsessed`（toefl）
- `ohp`（ielts）
- `open-book`（ielts）
- `packed`（toefl）
- `pages`（ielts）
- `part-time`（ielts）
- `patients`（ielts）
- `patroller`（toefl）
- `perennially`（toefl）
- `phd`（ielts）
- `phone-in`（ielts）
- `photos`（ielts）
- `pioneering`（toefl）
- `planning`（ielts）
- `predominantly`（toefl）
- `prescribed`（toefl）
- `problems`（ielts）
- `prohibitively`（toefl）
- `purified`（toefl）
- `questions`（ielts）
- `readers`（ielts）
- `reinforced`（ielts）
- `relations`（ielts）
- `rentable`（toefl）
- `reverently`（toefl）
- `rivers`（ielts）
- `robots`（ielts）
- `roommate`（ielts）
- `routinely`（toefl）
- `saltiness`（toefl）
- `scrupulously`（toefl）
- `seamen`（toefl）
- `sheltered`（toefl）
- `shoes`（ielts）
- `space shuttle`（toefl）
- `sparingly`（toefl）
- `specialized`（toefl）
- `specified`（toefl）
- `spectacularly`（toefl）
- `spectra`（toefl）
- `spontaneously`（toefl）
- `sporadically`（toefl）
- `stairs`（ielts）
- `states`（ielts）
- `steps`（ielts）
- `stimuli`（toefl）
- `strenuously`（toefl）
- `stressful`（ielts）
- `strikingly`（toefl）
- `stubbornness`（toefl）
- `stylized`（toefl）
- `subduct`（toefl）
- `subjected`（toefl）
- `sunglasses`（toefl）
- `superficially`（toefl）
- `supremely`（toefl）
- `textured`（toefl）
- `tones`（ielts）
- `toys`（ielts）
- `traditionally`（toefl）
- `travelers`（ielts）
- `troubling`（toefl）
- `turnpike`（toefl）
- `unevenly`（toefl）
- `unquestionably`（toefl）
- `videotape`（ielts）
- `visitors`（ielts）
- `waggon`（ielts）
- `water-skiing`（ielts）
- `website`（ielts）
- `weekdays`（ielts）
- `westerner`（ielts）
- `words`（ielts）

## 音标字符串已损坏（0）

没有残留的坏音标。原先 `ɜ` 被写成反斜杠的条目，以及 3 条方括号音标，已经按原字符串里的辅音还原，没有新猜元音。

## 没有例句也没有英文释义（38）

中文释义还在。没有现成英文例句或 ECDICT definition 可以抄，所以留空。

- `account for`（ielts）：对…负有责任；对…做出解释；说明……的原因；导致；（比例）占
- `assistantship`（toefl）：(大学)研究生助教奖学金
- `booklist`（ielts）：(某个题目或学科的)推荐书目；书单
- `bring about`（ielts）：带来；使掉头
- `close-up`（ielts）：特写镜头；仔细的观察；小传
- `co-operation`（ielts）：合作
- `co-operative`（ielts）：合作的；有协作精神的；愿意配合的; 齐心协力的；合作进行的；合作社；合作机构
- `craftspeople`（toefl）：工匠；手艺人；工艺师
- `endotherm`（toefl）：热血动物
- `far-reaching`（toefl）：深远的；广泛的；伸至远处的
- `first-aid`（ielts）：急救的
- `flourishment`（ielts）：繁荣
- `forbes`（ielts）：福布斯（美国出版及媒体集团）；福布斯（美国著名财经杂志）；福布斯（姓氏）
- `geomagnetic`（toefl）：地磁的
- `helpline`（ielts）：热线服务电话
- `in spite of`（toefl）：不管
- `keywords`（ielts）：关键字
- `long-standing`（toefl）：长期存在的
- `midmorning`（ielts）：上午十时左右
- `non-drinker`（ielts）：不喝酒的人；戒酒的人
- `ohp`（ielts）：overhead projection 高架发射；顶置防护; oxygen at high pressure 高压氧气
- `open-book`（ielts）：开卷的
- `per capita`（toefl）：每人；按人口；按人口计算
- `second-hand`（ielts）：用过的；旧货的；旧的；间接的；传来的；第二手的
- `semimolten`（toefl）：半熔化的
- `space shuttle`（toefl）：航天飞机
- `springwater`（toefl）：泉水
- `stereophotograph`（toefl）：立体照片；立体照相；立体照像
- `subdiscipline`（toefl）：学科的分支
- `suburbanization`（toefl）：市郊化；郊区化；近郊化
- `supercontinent`（toefl）：[地]超大陆
- `survivability`（toefl）：残存性；生存性；耐受性
- `telecommuter`（toefl）：远程工作者
- `ultrasonics`（toefl）：超声学
- `urbanism`（toefl）：城市居民的生活方式；城市化
- `urbanite`（toefl）：城市居民
- `water-clock`（ielts）：水钟；滴漏
- `wollongong`（ielts）：伍伦贡[澳大利亚东南部港市]
