#!/usr/bin/env python3
"""论文/文档 -> Markdown -> 知识库 的最小可跑管线。

对应 docs/03-integration-plan.md 的「链路 1」。

用法:
    pip install markitdown requests
    python scripts/paper_pipeline.py --src ~/Zotero/storage --out ./data/markdown
    # 顺便推送到 RAGFlow 知识库:
    python scripts/paper_pipeline.py --src ... --out ... \
        --ragflow http://localhost:9380 --api-key $RAGFLOW_KEY --dataset papers

设计原则: 转换与入库解耦, Markdown 落盘可复查, 增量跳过已处理文件。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SUPPORTED = {".pdf", ".docx", ".pptx", ".xlsx", ".epub", ".html", ".htm", ".txt", ".md"}
STATE_FILE = ".pipeline_state.json"


def sha1(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def load_state(out: Path) -> dict:
    p = out / STATE_FILE
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(out: Path, state: dict) -> None:
    (out / STATE_FILE).write_text(json.dumps(state, indent=2, ensure_ascii=False))


def convert(src_file: Path) -> str:
    """用 microsoft/markitdown 转 Markdown。"""
    try:
        from markitdown import MarkItDown
    except ImportError:
        sys.exit("缺少依赖: pip install 'markitdown[all]'")
    return MarkItDown().convert(str(src_file)).text_content


def push_ragflow(base: str, api_key: str, dataset: str, name: str, text: str) -> bool:
    import requests

    url = f"{base.rstrip('/')}/api/v1/datasets/{dataset}/documents"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        files={"file": (name, text.encode("utf-8"), "text/markdown")},
        timeout=120,
    )
    if r.ok:
        return True
    print(f"  ! RAGFlow 入库失败 {r.status_code}: {r.text[:200]}")
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="文献/文档 -> Markdown -> 知识库")
    ap.add_argument("--src", required=True, help="源目录, 例如 ~/Zotero/storage")
    ap.add_argument("--out", default="./data/markdown", help="Markdown 输出目录")
    ap.add_argument("--ragflow", help="RAGFlow 地址, 留空则只转换不入库")
    ap.add_argument("--api-key", help="RAGFlow API Key")
    ap.add_argument("--dataset", default="papers", help="RAGFlow 知识库 ID/名称")
    ap.add_argument("--force", action="store_true", help="忽略增量状态, 全量重跑")
    args = ap.parse_args()

    src = Path(args.src).expanduser()
    out = Path(args.out).expanduser()
    if not src.is_dir():
        sys.exit(f"源目录不存在: {src}")
    out.mkdir(parents=True, exist_ok=True)

    state = {} if args.force else load_state(out)
    files = sorted(p for p in src.rglob("*") if p.suffix.lower() in SUPPORTED and p.is_file())
    print(f"发现 {len(files)} 个候选文件")

    done = skipped = failed = 0
    for f in files:
        key = str(f.relative_to(src))
        digest = sha1(f)
        if state.get(key) == digest:
            skipped += 1
            continue
        print(f"-> {key}")
        try:
            md = convert(f)
        except Exception as e:  # noqa: BLE001
            print(f"  ! 转换失败: {e}")
            failed += 1
            continue

        target = out / (f.stem + ".md")
        target.write_text(f"# {f.stem}\n\n<!-- source: {key} -->\n\n{md}", encoding="utf-8")

        if args.ragflow:
            if not args.api_key:
                sys.exit("--ragflow 需要同时提供 --api-key")
            if not push_ragflow(args.ragflow, args.api_key, args.dataset, target.name, md):
                failed += 1
                continue

        state[key] = digest
        done += 1
        save_state(out, state)

    print(f"\n完成: 新处理 {done} / 跳过 {skipped} / 失败 {failed}")
    print(f"Markdown 输出: {out.resolve()}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
