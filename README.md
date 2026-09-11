# 科研 + 办公 开源栈调研与整合方案

本仓库分支 `arena/01a08f71-new` 汇总了 **近几个月 GitHub 上 star 最多 / 增长最快** 的开源项目，
筛选出对 **科研（文献、实验、写作、复现）** 和 **办公（文档、协作、自动化）** 真正有用的部分，
并给出一套**可以整合在一起落地**的自托管方案。

调研时间：2026-09

## 目录

| 文件 | 内容 |
|---|---|
| [docs/01-monthly-trending.md](docs/01-monthly-trending.md) | 近几个月月度最火 / star 最多仓库总榜 |
| [docs/02-research-office-picks.md](docs/02-research-office-picks.md) | 科研 & 办公向精选（含选型理由与取舍） |
| [docs/03-integration-plan.md](docs/03-integration-plan.md) | 哪些可以整合在一起 + 整合架构 |
| [stack/docker-compose.yml](stack/docker-compose.yml) | 一键起本地科研办公栈（可选服务分 profile） |
| [scripts/paper_pipeline.py](scripts/paper_pipeline.py) | 论文/文档 → Markdown → 知识库 的最小可跑管线 |

## 一句话结论

> **Ollama/vLLM（本地模型） + Dify 或 RAGFlow（知识库与工作流） + MarkItDown/anydoc（文档转换） +
> n8n（办公自动化） + Zotero（文献源） + Open WebUI（统一入口）**
> 这五层用 MCP / HTTP API 串起来，就是一套完整的「个人科研 + 团队办公」自托管系统。

快速开始见 [docs/03-integration-plan.md](docs/03-integration-plan.md#快速开始)。
