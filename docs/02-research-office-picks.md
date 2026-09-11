# 二、科研 & 办公向精选（选型与取舍）

按「你真的会天天用」的标准，从上一章的榜单里筛出 5 层共 18 个项目。

## 2.1 科研场景

### A. 文献获取与阅读
| 项目 | Star | 为什么选它 | 取舍 |
|---|---|---|---|
| **Zotero / zotero-better-notes** | ~12k | 事实标准的文献库，插件生态好，有本地 SQLite 可被程序读取 | 不用 EndNote：不开放 |
| **macro-inc/macro** | 新星 | Rust 桌面文档工作台，PDF 阅读 + AI 标注，快 | 可选，替代 Zotero 阅读器 |
| **firecrawl** | 178k | 抓 arXiv / 期刊页面并转干净 Markdown，专为 Agent 设计 | 比自写爬虫省事；有云也可自托管 |
| **bytedance/deer-flow** | 76k | Deep Research：自动检索→阅读→生成带引用的综述 | 比手搓 LangGraph 快 |

### B. 文档解析（决定 RAG 上限，最关键的一层）
| 项目 | Star | 亮点 |
|---|---|---|
| **microsoft/markitdown** | ~96k | Office/PDF/图片/音频 → Markdown，一行 CLI，最通用 |
| **anydoc**（Rust） | 新星 | 更快，Office/PDF/EPUB → 干净 Markdown |
| **pdf-inspector**（Rust） | 新星 | 判断 PDF 是否需要 OCR，选择性 OCR，省算力 |
| **RAGFlow DeepDoc** | 77k | 版面识别、表格还原，学术 PDF 质量最好 |

> 建议：**markitdown 做兜底 + RAGFlow DeepDoc 处理正式入库的论文**。

### C. 知识库 / 检索
| 项目 | Star | 适合 |
|---|---|---|
| **RAGFlow** | 77k | 文档密集、要表格和公式，学术首选 |
| **LightRAG** | 29–35k | 轻量 GraphRAG，跨论文关联发现，适合做综述 |
| **LlamaIndex** | 40k | 需要自定义检索管线时 |
| **mem0** | 52k | 给助手加长期记忆（记住你的研究方向） |

### D. 模型与实验
| 项目 | Star | 用途 |
|---|---|---|
| **Ollama** | 176k | 本地一键跑模型，接口兼容 OpenAI |
| **vLLM** | 79–86k | 批量推理跑实验（比 Ollama 吞吐高一个量级） |
| **LLaMA-Factory / unsloth** | 73k / 新星 | 微调；unsloth 单卡省显存 |
| **MLflow** | 27k | 实验参数/指标/产物追踪，写论文时能复现 |
| **google-research/timesfm** | 3.8k↑ | 时序预测基础模型，零样本 baseline |

### E. 表达与产出
| 项目 | 用途 |
|---|---|
| **tt-a1i/archify** | 自动画架构/流程/时序图，论文和汇报配图 |
| **VoiceStudio** | 组会/访谈录音本地转写；讲稿配音 |
| **hyperframes** | HTML → 视频，做成果展示 |

## 2.2 办公场景

| 项目 | Star | 用途 | 备注 |
|---|---|---|---|
| **n8n** | 186–204k | 工作流自动化，400+ 集成（邮件、日历、飞书、Slack、DB） | 办公自动化中枢 |
| **Dify** | 136–155k | 低代码搭 AI 应用 / 知识库问答，给同事用 | 比 Coze 可自托管 |
| **Open WebUI** | 135k | 统一聊天入口，支持权限、多模型、文档上传 | 团队门面 |
| **openclaw** | 389k | 跨 WhatsApp/Slack/Telegram 的常驻助手 | 增长最猛，但生态新、需谨慎评估安全 |
| **browser-use** | 86–103k | 让 Agent 操作网页（填报表、抓后台数据） | 替人做重复网页操作 |
| **AnythingLLM** | 35–60k | 一体化私有知识库，Docker 起就能用 | 想省事可替代 Dify+RAGFlow |
| **microsoft/tgrep** | 2.6k↑ | 大代码库/大语料秒级正则检索 | 开发向 |
| **spec-kit** | 128k | 规格驱动开发，把需求写清楚再交给 Agent | 项目管理 |

## 2.3 明确不选 / 慎选

| 项目 | 原因 |
|---|---|
| AutoGPT（183k） | 星多但自主执行不稳定，实际产出低 |
| GraphRAG（33k） | 月提交个位数，降温；改用 LightRAG |
| 各类 awesome / roadmap 清单 | 只读不产出，收藏即可 |
| openclaw | 增长过快、权限极大（能操作你所有 IM），生产环境先隔离沙箱试用 |

## 2.4 最终精选（10 个，装机必备）

1. Ollama — 本地模型底座
2. vLLM — 批量实验推理（有 GPU 才装）
3. Open WebUI — 统一入口
4. Dify — 工作流 / 应用层
5. RAGFlow — 学术文档知识库
6. LightRAG — 图谱式跨论文关联
7. markitdown — 万物转 Markdown
8. n8n — 办公自动化
9. MLflow — 实验追踪
10. Zotero — 文献源
