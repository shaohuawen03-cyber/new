# -*- coding: utf-8 -*-
"""Fill attachment3 (学业奖学金审批表) as DOCX in the sandbox.

Pipeline: Spire.Doc converts the original .doc -> .docx (faithful layout),
python-docx then (1) strips the Spire evaluation paragraph, (2) fills known
label/value cells, (3) ticks the 硕士 checkbox, (4) inserts the school-variant
200字 reason right after the hint line inside the reason cell.

Run: /tmp/v/bin/python code/fill_attach3_docx.py
"""
import os, sys, copy

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'sources', '附件3：鲁东大学2026年研究生学业奖学金申请审批表.doc')
OUT = os.path.join(REPO, 'deliverable', '附件3：鲁东大学2026年研究生学业奖学金申请审批表_filled.docx')
REASON_TXT = os.path.join(REPO, 'deliverable', '申请理由200字_学业奖学金版.txt')
TMP_DOCX = '/tmp/attach3_spire.docx'

VALUES = {
    '姓名': '文绍华',
    '政治面貌': '共青团员',
    '所在学院': '生命科学学院',
    '专业': '生物学',
    '攻读学位': '硕士',
    '学号': '2024110316',
}
TICK_FROM, TICK_TO = '□硕士', '☑硕士'
REASON_LABEL = '个人申请理由'
HINT = '包括'


def convert():
    from spire.doc import Document as SDocument, FileFormat
    doc = SDocument()
    doc.LoadFromFile(SRC)
    doc.SaveToFile(TMP_DOCX, FileFormat.Docx2019)
    doc.Close()


def reason_lines():
    lines = open(REASON_TXT, encoding='utf-8').read().splitlines()
    return lines[2].strip()


def unique_cells(table):
    seen, out = set(), []
    for row in table.rows:
        for c in row.cells:
            if id(c._tc) in seen:
                continue
            seen.add(id(c._tc))
            out.append(c)
    return out


def main():
    from docx import Document

    convert()
    d = Document(TMP_DOCX)

    # 1) strip the evaluation warning paragraphs (any paragraph containing it)
    killed = 0
    for p in list(d.paragraphs):
        if 'Evaluation Warning' in p.text:
            p._element.getparent().remove(p._element)
            killed += 1
    print('eval paragraphs removed:', killed)

    reason = reason_lines()
    filled = []

    t0 = d.tables[0]
    cells = unique_cells(t0)

    # 2) label -> next empty cell
    for i, c in enumerate(cells):
        txt = c.text.strip()
        if txt in VALUES and i + 1 < len(cells):
            nxt = cells[i + 1]
            if not nxt.text.strip():
                nxt.paragraphs[0].add_run(VALUES[txt])
                filled.append(txt)

    # 3) tick checkbox (口/硕 may sit in separate runs; fall back to paragraph rebuild)
    for c in cells:
        if TICK_FROM in c.text:
            done = False
            for p in c.paragraphs:
                for r in p.runs:
                    if TICK_FROM in r.text:
                        r.text = r.text.replace(TICK_FROM, TICK_TO)
                        done = True
                if not done and TICK_FROM in p.text and p.runs:
                    merged = p.text.replace(TICK_FROM, TICK_TO)
                    p.runs[0].text = merged
                    for r in p.runs[1:]:
                        r.text = ''
                    done = True
            if done:
                filled.append('硕士勾选')

    # 4) reason into the cell that holds the hint (right after the hint para)
    for i, c in enumerate(cells):
        if c.text.strip() == REASON_LABEL:
            target = None
            for j in range(i + 1, len(cells)):
                if HINT in cells[j].text:
                    target = cells[j]
                    break
            if target is None:
                raise SystemExit('reason cell not found')
            hint_p = target.paragraphs[0]
            for r in hint_p.runs:
                pass  # keep hint paragraph untouched
            new_p = copy.deepcopy(hint_p._p)
            hint_p._p.addnext(new_p)
            # rewrite the cloned paragraph with the reason text
            from docx.text.paragraph import Paragraph
            np = Paragraph(new_p, target.paragraphs[0]._parent)
            for r in list(np.runs):
                r._element.getparent().remove(r._element)
            np.add_run(reason)
            filled.append('个人申请理由')
            break

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    d.save(OUT)
    print('filled:', len(filled), '->', filled)
    print('saved:', OUT)
    if len(filled) < 7:
        raise SystemExit('too few fields filled, aborting')


if __name__ == '__main__':
    main()
