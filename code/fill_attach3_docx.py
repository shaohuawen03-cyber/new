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
    '性别': '男',
    '出生年月': '2002.03.04',
    '政治面貌': '共青团员',
    '民族': '汉族',
    '入学时间': '2024.08.25',
    '所在学院': '生命科学学院',
    '专业': '生物学',
    '攻读学位': '硕士',
    '学制': '三年',
    '学号': '2024110316',
}
ID_NUMBER = '51370120020302041X'   # 18 digits, one per cell in the form
ID_LABEL = '身份证号'
TICK_FROM, TICK_TO = '□硕士', '☑硕士'
LEVEL_FROM, LEVEL_TO = '硕士一等□', '硕士一等☑'   # 档次如有异议自己改勾
TITLE_YEAR_FROM, TITLE_YEAR_TO = '大学202  年', '大学2026年'
REASON_LABEL = '个人申请理由'
ADVISOR_LABEL = '导师推荐意见'
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

    # 2.5) title year blank: 大学202  年 -> 大学2026年 (run-fragment safe: rebuild para runs)
    for p in d.paragraphs:
        if TITLE_YEAR_FROM in p.text:
            for r in p.runs:
                if TITLE_YEAR_FROM in r.text:
                    r.text = r.text.replace(TITLE_YEAR_FROM, TITLE_YEAR_TO)
            if TITLE_YEAR_FROM in p.text:
                merged = p.text.replace(TITLE_YEAR_FROM, TITLE_YEAR_TO)
                if p.runs:
                    p.runs[0].text = merged
                    for r in p.runs[1:]:
                        r.text = ''
            filled.append('标题年份2026')

    # 2.6) 身份证号: one digit per cell across the 18 tiny cells of that row
    for i, c in enumerate(cells):
        if c.text.strip() == ID_LABEL:
            placed = 0
            for j in range(i + 1, min(i + 40, len(cells))):
                if placed >= len(ID_NUMBER):
                    break
                if not cells[j].text.strip():
                    cells[j].paragraphs[0].add_run(ID_NUMBER[placed])
                    placed += 1
            if placed == len(ID_NUMBER):
                filled.append('身份证号x18')
            else:
                raise SystemExit('id cells short: placed %d of %d' % (placed, len(ID_NUMBER)))
            break

    # 2.7) hard pagination: force 导师推荐意见 row to start page 2 so the whole
    #      个人申请理由 block stays on page 1 (pageBreakBefore in row's 1st para)
    for row in t0.rows:
        rowtxt = ''.join(c.text for c in row.cells)
        if ADVISOR_LABEL in rowtxt:
            row.cells[0].paragraphs[0].paragraph_format.page_break_before = True
            filled.append('分页符@导师推荐意见')
            break
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

    # 3.5) 申请级别 tick 硕士一等 (box sits AFTER the label text)
    for c in cells:
        if LEVEL_FROM in c.text:
            done = False
            for p in c.paragraphs:
                for r in p.runs:
                    if LEVEL_FROM in r.text:
                        r.text = r.text.replace(LEVEL_FROM, LEVEL_TO)
                        done = True
                if not done and LEVEL_FROM in p.text and p.runs:
                    merged = p.text.replace(LEVEL_FROM, LEVEL_TO)
                    p.runs[0].text = merged
                    for r in p.runs[1:]:
                        r.text = ''
                    done = True
            if done:
                filled.append('申请级别硕士一等')

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

    # ---- layout pass -------------------------------------------------------
    # 1) reason text: 14pt font + 1pt character spacing + 1.15 line spacing so
    #    the big cell stops looking empty ('太空了'); measured to fit page 1.
    # 2) empty filler paragraphs pinned at exact 12pt lines (no growth).
    # 3) reason row height locked hRule="exact" so it can NEVER push content
    #    to page 3 in Word/WPS; 导师推荐意见 row already has pageBreakBefore.
    from docx.shared import Pt
    from docx.enum.text import WD_LINE_SPACING
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    d2 = Document(OUT)
    t2 = d2.tables[0]
    for row in t2.rows:
        for c in row.cells:
            if HINT in c.text and reason[:10] in c.text:
                for p in c.paragraphs:
                    t = p.text.strip()
                    if t and reason[:10] in t:
                        p.paragraph_format.line_spacing = 1.15
                        p.paragraph_format.space_after = Pt(6)
                        for r in p.runs:
                            r.font.size = Pt(14)
                            rPr = r._element.get_or_add_rPr()
                            sp = OxmlElement('w:spacing')
                            sp.set(qn('w:val'), '20')  # +1pt char spacing
                            rPr.append(sp)
                    elif not t:
                        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
                        p.paragraph_format.line_spacing = Pt(12)
                # lock this row's height exactly (original design value)
                trPr = row._tr.get_or_add_trPr()
                for old in trPr.findall(qn('w:trHeight')):
                    trPr.remove(old)
                th = OxmlElement('w:trHeight')
                th.set(qn('w:val'), '9418')
                th.set(qn('w:hRule'), 'exact')
                trPr.append(th)
                break
    d2.save(OUT)

    # ---- verify: full doc still matches the original 2-page row geometry ---
    import zipfile, re
    xml = zipfile.ZipFile(OUT).read('word/document.xml').decode('utf-8')
    print('id digits placed:', len(re.findall(rf'[{ID_NUMBER[0]}{ID_NUMBER[-1]}]', xml)), '| pageBreakBefore:', xml.count('pageBreakBefore'))
    print('trHeight exact locks:', xml.count('hRule="exact"'))

    print('filled:', len(filled), '->', filled)
    print('saved:', OUT)
    if len(filled) < 14:
        raise SystemExit('too few fields filled, aborting')


if __name__ == '__main__':
    main()
