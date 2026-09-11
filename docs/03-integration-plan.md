# 三、整合方案：哪些能拼在一起，怎么拼

## 3.1 为什么这些能整合

它们恰好在四个「通用接口」上对齐了，所以不需要写胶水层就能互通：

| 通用接口 | 谁提供 | 谁消费 |
|---|---|---|
| **OpenAI 兼容 API**（`/v1/chat/completions`） | Ollama、vLLM、LocalAI | Open WebUI、Dify、RAGFlow、LightRAG、n8n、mem0 |
| **Markdown** 作为统一中间格式 | markitdown、anydoc、firecrawl、RAGFlow DeepDoc | 所有 RAG / 知识库 |
| **MCP**（工具协议） | browser-use、firecrawl、playwright-mcp、tgrep | Dify、Open WebUI、Claude/Gemini CLI |
| **Webhook / REST** | n8n、Dify、RAGFlow、MLflow | 互相触发 |

结论：**只要把「模型服务」统一到 OpenAI 协议、把「文档」统一到 Markdown，其余都是接线。**

## 3.2 整合架构

```
                          ┌────────────────────────────┐
   浏览器 / IM / 邮件  ──▶ │  入口层  Open WebUI        │
                          │        （+ openclaw 可选） │
                          └──────────────┬─────────────┘
                                         │ OpenAI API / MCP
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
┌────────────────┐            ┌────────────────────┐          ┌────────────────────┐
│ 编排层 Dify    │            │ 知识层 RAGFlow     │          │ 自动化层 n8n       │
│ 工作流/Agent   │◀── HTTP ──▶│ + LightRAG(图谱)   │◀────────▶│ 邮件/日历/表格/IM  │
└───────┬────────┘            └─────────┬──────────┘          └─────────┬──────────┘
        │                               │ Markdown                      │
        │                     ┌─────────▼──────────┐                    │
        │                     │ 摄取层             │                    │
        │                     │ markitdown/anydoc  │◀── Zotero 本地库 ──┘
        │                     │ firecrawl(网页)    │◀── arXiv / 期刊
        │                     └─────────┬──────────┘
        ▼                               ▼
┌──────────────────────────────────────────────────────────┐
│ 模型层  Ollama（日常） / vLLM（批量实验）  OpenAI 兼容    │
└──────────────────────────────────────────────────────────┘
        ▲
┌───────┴──────────┐
│ 科研侧 MLflow    │  实验追踪 · LLaMA-Factory/unsloth 微调 · timesfm baseline
└──────────────────┘
```

## 3.3 三条已经串通的「整合链路」

### 链路 1：论文自动入库 → 可问答（科研）
```
Zotero 新增文献
  → n8n 定时扫描 Zotero SQLite / WebDAV
  → pdf-inspector 判断是否 OCR → markitdown / DeepDoc 转 Markdown
  → 写入 RAGFlow 知识库（同时喂给 LightRAG 建实体图）
  → Open WebUI 里直接问 "我库里关于 XX 的方法有哪些分歧？"
```
最小可跑版本见 [`scripts/paper_pipeline.py`](../scripts/paper_pipeline.py)。

### 链路 2：周报 / 会议纪要自动化（办公）
```
会议录音 → VoiceStudio 本地转写
  → n8n 触发 Dify 工作流（摘要 + 待办抽取）
  → 待办写入 Notion/飞书；纪要归档进知识库
  → 周五 n8n 汇总本周 Git 提交 + 待办 → 生成周报草稿 → 邮件
```

### 链路 3：文献综述 Deep Research（科研 × 办公）
```
一句话课题 → deer-flow / Dify Agent
  → firecrawl 抓 arXiv + 网页
  → RAGFlow 检索本地库做交叉验证
  → LightRAG 出关联图谱 → archify 出结构图
  → 输出带引用的 Markdown 综述 → 存进知识库
```

## 3.4 整合中的坑

| 坑 | 对策 |
|---|---|
| Dify / RAGFlow / Open WebUI 各自维护一套知识库，数据割裂 | **只让 RAGFlow 做唯一知识库**，Dify 通过其 API 检索，别在 Dify 里再传一份 |
| 各服务都想占 80/3000 端口 | 用下面 compose 里统一的端口映射 |
| 容器里访问宿主 Ollama | 用 `host.docker.internal:11434`（compose 已配 extra_hosts） |
| 向量库重复（Chroma/Qdrant/Elasticsearch 各起一个） | 统一到 RAGFlow 自带的 ES/Infinity，LightRAG 复用 |
| 显存不够 | Ollama 与 vLLM 不要同时常驻；vLLM 用 profile 按需起 |

## 3.5 分阶段落地

- **第 1 周（最小可用）**：Ollama + Open WebUI + markitdown。手动拖论文进来问答。
- **第 2–3 周（知识库）**：加 RAGFlow，把 Zotero 全库导入，跑通链路 1。
- **第 4 周（自动化）**：加 n8n + Dify，跑通链路 2。
- **第 2 个月（研究增强）**：加 LightRAG / deer-flow / MLflow，跑通链路 3。

## 快速开始

```bash
git clone <本仓库> research-office-stack
cd research-office-stack/stack
cp .env.example .env          # 按需改端口和模型
docker compose up -d          # 起 ollama + open-webui + n8n
docker compose --profile kb up -d      # 额外起 RAGFlow（吃内存，需 >=16G）
docker compose --profile gpu up -d     # 有 GPU 时起 vLLM

# 文档转 Markdown 并入库
python ../scripts/paper_pipeline.py --src ~/Zotero/storage --out ./data/markdown
```

| 服务 | 地址 |
|---|---|
| Open WebUI | http://localhost:3080 |
| n8n | http://localhost:5678 |
| RAGFlow | http://localhost:9380 |
| Ollama API | http://localhost:11434 |
| MLflow | http://localhost:5000 |
