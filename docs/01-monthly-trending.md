# 一、近几个月 GitHub 最火 / star 最多仓库

> 数据来源：GitHub Ranking（EvanLi/Github-Ranking）、trendshift.io 月榜、各类 2026 年榜单聚合。
> star 数为调研时（2026-09）的量级，会持续变动，仅用于**相对排序**。

## 1.1 历史总榜 Top 10（累计 star，"最多"）

| # | 仓库 | Star | 语言 | 说明 | 对科研/办公 |
|---|---|---|---|---|---|
| 1 | codecrafters-io/build-your-own-x | 546k | Markdown | 从零复刻各种技术 | 学习 |
| 2 | sindresorhus/awesome | 505k | - | Awesome 索引 | 索引 |
| 3 | public-apis/public-apis | 478k | Python | 免费 API 集合 | 数据获取 ✅ |
| 4 | freeCodeCamp | 455k | TS | 免费课程 | 学习 |
| 5 | free-programming-books | 396k | - | 免费书 | 学习 |
| 6 | **openclaw/openclaw** | 389k | TS | 跨平台 AI 助手（60 天 9k→188k，史上最快） | 办公自动化 ✅ |
| 7 | system-design-primer | 369k | Python | 系统设计 | 学习 |
| 8 | developer-roadmap | 367k | TS | 学习路线 | 学习 |
| 9 | coding-interview-university | 361k | - | 面试 | 学习 |
| 10 | vinta/awesome-python | 320k | Python | Python 选型索引 | 工具索引 ✅ |

> 观察：总榜前十**大多是「清单/教程」类**，对科研办公的实际生产力帮助有限，
> 真正能用的要看下面的 **AI 工具类** 与 **月度增量榜**。

## 1.2 AI / 工具类高星榜（真正能用的生产力工具）

| 仓库 | Star | 定位 | 科研 | 办公 |
|---|---|---|---|---|
| ollama/ollama | 176k | 本地跑大模型，一行命令 | ✅✅ | ✅✅ |
| f/prompts.chat | 161k | 提示词库 | ✅ | ✅ |
| dify (langgenius) | 136–155k | 低代码 Agent + RAG 平台 | ✅✅ | ✅✅ |
| open-webui | 135k | 自托管 ChatGPT 界面 | ✅✅ | ✅✅ |
| langchain | 132–141k | LLM 编排框架 | ✅✅ | ✅ |
| ggml-org/llama.cpp | 120k | CPU/Apple Silicon 推理 | ✅ | ✅ |
| google-gemini/gemini-cli | 100–106k | 终端 AI 代理 | ✅ | ✅ |
| microsoft/markitdown | ~96k | Office/PDF → Markdown | ✅✅ | ✅✅ |
| browser-use | 86–103k | 让 Agent 操作浏览器 | ✅ | ✅✅ |
| vllm | 79–86k | 高吞吐推理服务 | ✅✅（批量实验） | - |
| infiniflow/ragflow | 77–80k | 深度文档解析 RAG 引擎 | ✅✅ | ✅✅ |
| hiyouga/LLaMA-Factory | 73k | 微调全家桶 | ✅✅ | - |
| n8n-io/n8n | 186–204k | 工作流自动化，400+ 集成 | ✅ | ✅✅ |
| firecrawl | 178k | 网页抓取/搜索给 Agent 用 | ✅✅ | ✅ |
| mem0 | 52k | Agent 长期记忆 | ✅ | ✅ |
| AnythingLLM | 35–60k | 隐私优先的一体化知识库 | ✅✅ | ✅ |
| LlamaIndex | 40–46k | RAG-first 数据框架 | ✅✅ | - |
| LightRAG（港大） | 29–35k | 轻量 GraphRAG，EMNLP | ✅✅ | - |
| microsoft/graphrag | 31–33k | 图谱驱动 RAG | ✅✅ | ✅ |
| mlflow | 27k | 实验追踪 | ✅✅ | - |
| github/spec-kit | 128k | 规格驱动开发 | ✅ | ✅ |

## 1.3 月度增量榜（"最近每个月最火"）

trendshift 月榜 / 日榜里近月冒出的新项目（新星，star 基数小但增速最猛）：

| 项目 | 月增 star | 干什么 | 值不值得看 |
|---|---|---|---|
| tt-a1i/archify | 18.1k | Agent 技能：自动生成架构/流程/时序/数据流图，导出自包含 HTML | ★★★ 论文配图/方案图 |
| DietrichGebert/ponytail | 15.8k | 多智能体交互式课堂 | ★★ 教学 |
| debpalash/VoiceStudio | 9.4k | 全本地语音克隆/转写/配音，646 语言 | ★★★ 会议转写、讲稿 |
| stablyai/orca | 7.1k | 测试/QA Agent | ★ |
| lnkiai/m3e-canvas | 5.4k | 草图 → vibe-coding 提示词 | ★ |
| heygen-com/hyperframes | 5.2k | 写 HTML 渲染视频，给 Agent 用 | ★★ 汇报视频 |
| google-research/timesfm | 3.8k | 时间序列基础模型 | ★★★ 科研预测任务 |
| Tencent/teamai-cli | 2.7k | 多 Agent 团队 CLI | ★★ |
| microsoft/tgrep | 2.6k | 三元组索引 grep，大代码库秒级正则搜索 | ★★★ 代码/语料检索 |
| macro-inc/macro | 日增 400+ | Rust 写的 PDF/文档工作台 | ★★★ 读论文 |
| anthropics/skills / awesome-claude-skills | - | 可复用 Agent 技能包 | ★★★ |
| anydoc / pdf-inspector | - | Rust：Office/PDF/EPUB→Markdown、PDF 分类+选择性 OCR | ★★★ 文献入库 |
| unslothai/unsloth | - | 2–5x 快、少显存的微调 | ★★★ 实验室单卡微调 |
| Tencent/WeKnora | 15k | 混合检索（关键词+向量+图谱）+ ReACT Agent | ★★★ |
| bytedance/deer-flow | 76k | 深度研究（Deep Research）框架 | ★★★ 综述/调研 |

## 1.4 趋势判断

1. **从「框架」转向「可组合技能 + MCP 工具」**：2026 年增速最快的不是新框架，而是 skills/MCP 工具包。
2. **文档解析成为刚需**：markitdown / anydoc / RAGFlow DeepDoc / macro 全部围绕「PDF→结构化」。
3. **本地化、隐私优先**：Ollama、VoiceStudio、AnythingLLM、Open WebUI 都主打 100% 本地。
4. **深度研究（Deep Research）** 是科研场景的最大增量：deer-flow、firecrawl、GraphRAG 的组合。
