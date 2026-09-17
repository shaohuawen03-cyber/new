# -*- coding: utf-8 -*-
"""Build the scholarship deliverables (合订本PDF + 已填表DOCX + 理由TXT).

Inputs (from user's upload): sources/*.pdf/.docx/.doc
Outputs (committed to git):
  deliverable/国家奖学金支撑材料合订本_文绍华.pdf
  deliverable/附件2_申请审批表_已填申请理由.docx
  deliverable/申请理由200字.txt

Fonts: fonts/SHS-R-sub.ttf / fonts/SHS-B-sub.ttf (subset of SourceHanSansCN,
built from THIS file's text via pyftsubset; fonts/ is gitignored).
Run:  .venv/bin/python code/build_deliverable.py
"""
import os, re, zipfile, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, "sources")
OUT_DIR = os.path.join(REPO, "deliverable")
FONTS_DIR = os.path.join(REPO, "code", "fonts")

PAPER_PDF = os.path.join(SRC_DIR, "Combined computational and spectroscopic analyses of the interactions between ginger compounds and bovine type I collagen.pdf")
WOS_DOCX = os.path.join(SRC_DIR, "文字文稿1.docx")
PDF_OUT = os.path.join(OUT_DIR, "国家奖学金支撑材料合订本_文绍华.pdf")
DOCX_OUT = os.path.join(OUT_DIR, "附件2_申请审批表_已填申请理由.docx")
TXT_OUT = os.path.join(OUT_DIR, "申请理由200字.txt")

REASON = ("本人文绍华，鲁东大学生命科学学院生物学2024级研究生，共青团员。"
"入学以来勤奋刻苦，严谨求实，必修课9门全部及格，综合考评排名16/29，"
"恪守学术道德，积极参与实验室科研工作。"
"本人以共同第一作者身份在农林科学TOP期刊Food Chemistry"
"（SCI升级版农林科学1区，IF 10.4）发表研究论文，"
"综合分子对接、分子动力学模拟与紫外、荧光、红外及量热实验，"
"阐明生姜主要活性成分稳定牛I型胶原蛋白的分子机制，为肉品品质调控提供理论依据。"
"现特此申请2025—2026学年研究生国家奖学金，望批准。")

# Every CJK char the PDF may print must exist in the subset font. This anchor
# plus all literals in this file are the subset source (see fonts/README).
CHARSET_ANCHOR = "年月日第部分页共计〇一二三四五六七八九十—…·（）／：；，。、待补充替换截图导官网占位封面目录清单生成说明打印核对复制正式官方声明插件标签影响因子检索类型归档编号卷期状态作者通讯单位密钥0123456789"

APPLICANT = {
    "姓名": "文绍华", "性别": "男", "出生年月": "2002.03.04",
    "政治面貌": "共青团员", "民族": "汉族", "入学时间": "2024.08.25",
    "院系": "生命科学学院", "专业": "生物学", "学制": "三年",
    "年级": "2024级", "班级": "生物学", "联系电话": "19861558892",
    "学校": "鲁东大学", "学号": "2024110316",
    "身份证号": "51370120020302041X",
}

PAPER_INFO = [
    ("论文标题", "Combined computational and spectroscopic analyses of the interactions between ginger compounds and bovine type I collagen"),
    ("期刊", "Food Chemistry"),
    ("卷 / 文章编号", "Volume 521 / 149910"),
    ("发表日期", "30 August 2026"),
    ("DOI", "10.1016/j.foodchem.2026.149910"),
    ("作者", "Shao-Hua Wen（文绍华，共同第一作者）; Hui-Ke Ma（共同第一作者）; Liang Shen（通讯作者）"),
    ("单位", "鲁东大学 生命科学学院；鲁东大学 食品工程学院 One Health食品药物研究院"),
    ("WOS收录日期", "2026-06-19（Indexed）"),
    ("文献类型", "Article"),
    ("分区 / 影响力标签", "农林科学TOP；EI检索；SCI升级版农林科学1区；SCI基础版工程技术2区；IF 10.4；SWJTU A+（截图中的浏览器插件标签）"),
]


def cjk_count(s):
    return len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef—…·]', s))


def extract_wos_image():
    with zipfile.ZipFile(WOS_DOCX) as z:
        for n in z.namelist():
            if n.startswith("word/media/") and not n.endswith("/"):
                data = z.read(n)
                ext = os.path.splitext(n)[1] or ".png"
                fd, path = tempfile.mkstemp(suffix=ext, prefix="wos_")
                os.write(fd, data); os.close(fd)
                return path
    raise SystemExit("no image found in " + WOS_DOCX)


# ---------------- PDF (reportlab) ----------------
def _register_fonts():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    pdfmetrics.registerFont(TTFont("SHS", os.path.join(FONTS_DIR, "SHS-R-sub.ttf")))
    pdfmetrics.registerFont(TTFont("SHS-B", os.path.join(FONTS_DIR, "SHS-B-sub.ttf")))


def _styles():
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    return {
        "title": ParagraphStyle("title", fontName="SHS-B", fontSize=20, leading=30, alignment=TA_CENTER, spaceAfter=12),
        "h1": ParagraphStyle("h1", fontName="SHS-B", fontSize=16, leading=24, spaceBefore=6, spaceAfter=10),
        "h2": ParagraphStyle("h2", fontName="SHS-B", fontSize=13, leading=19, spaceBefore=8, spaceAfter=6),
        "body": ParagraphStyle("body", fontName="SHS", fontSize=11, leading=17, alignment=TA_JUSTIFY, spaceAfter=6),
        "bodyL": ParagraphStyle("bodyL", fontName="SHS", fontSize=11, leading=17, alignment=0, spaceAfter=6),
        "center": ParagraphStyle("center", fontName="SHS", fontSize=11, leading=17, alignment=TA_CENTER, spaceAfter=4),
        "small": ParagraphStyle("small", fontName="SHS", fontSize=9, leading=13, alignment=TA_JUSTIFY, textColor="#444444", spaceAfter=4),
        "cell": ParagraphStyle("cell", fontName="SHS", fontSize=10, leading=15, alignment=TA_JUSTIFY),
        "cellB": ParagraphStyle("cellB", fontName="SHS-B", fontSize=10, leading=15),
        "toc": ParagraphStyle("toc", fontName="SHS", fontSize=12, leading=22),
    }


def _footer(canvas, doc, offset=0):
    canvas.saveState()
    canvas.setFont("SHS", 9)
    canvas.setFillColor("#666666")
    canvas.drawCentredString(297.5, 30, "第 %d 页" % (canvas.getPageNumber() + offset))
    canvas.restoreState()


def build_front(toc_entries, path):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.pagesizes import A4
    S = _styles()
    story = []
    story.append(Spacer(1, 90))
    story.append(Paragraph("2025—2026学年研究生国家奖学金", S["title"]))
    story.append(Paragraph("申请支撑材料合订本", S["title"]))
    story.append(Spacer(1, 30))
    story.append(Paragraph("申请人：文绍华（鲁东大学 生命科学学院 生物学2024级 学号2024110316）", S["center"]))
    story.append(Paragraph("代表性成果：Food Chemistry 521 (2026) 149910（共同第一作者）", S["center"]))
    story.append(Spacer(1, 20))
    story.append(Paragraph("本合订本按《要求.md》编排：目录 — 成果（论文全文）— WOS收录和分区 — JCR分区查询 — 申请理由。", S["body"]))
    story.append(Paragraph("其中“JCR分区查询”原件尚未取得，本版以占位页说明，待补充后替换重出；其余均为原件或原件截图。", S["body"]))
    story.append(Spacer(1, 10))
    story.append(Paragraph("生成日期：2026年9月17日", S["center"]))
    from reportlab.platypus import PageBreak
    story.append(PageBreak())
    story.append(Paragraph("目 录", S["title"]))
    story.append(Spacer(1, 12))
    for title, pages in toc_entries:
        story.append(Paragraph("%s<span> … %s</span>" % (title, pages), S["toc"]))
    story.append(Spacer(1, 16))
    story.append(Paragraph("注：正文页码为本合订本连续页码；论文部分保留期刊原版式。", S["small"]))
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=57, rightMargin=57, topMargin=57, bottomMargin=57,
                            title="合订本封面目录", author="文绍华")
    doc.build(story, onFirstPage=lambda c, d: _footer(c, d, 0), onLaterPages=lambda c, d: _footer(c, d, 0))


def build_back_section_wos(wos_img, path):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    S = _styles()
    story = [Paragraph("第二部分　WOS收录和分区证明", S["h1"]),
             Paragraph("来源：文字文稿1.docx（全文为一张WOS检索页截图，原样嵌入下图）", S["small"])]
    rows = [[Paragraph("<b>%s</b>" % k, S["cellB"]), Paragraph(v, S["cell"])] for k, v in PAPER_INFO]
    t = Table(rows, colWidths=[150, 332])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f2f2f2"))]))
    h2tight = ParagraphStyle("h2tight", parent=S["h2"], spaceBefore=2, spaceAfter=2)
    story += [t, Spacer(1, 2),
              Paragraph("WOS检索页截图（原件）：", h2tight)]
    img = Image(wos_img, width=400, height=400 * 925 / 1321)
    story.append(img)
    story.append(Spacer(1, 2))
    story.append(Paragraph("声明：上图为申请人提供的WOS检索截图；其中“农林科学TOP／1区／IF 10.4”等彩色标签为浏览器学术插件标注，非WOS原生字段，仅供评审参考。", S["small"]))
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=57, rightMargin=57, topMargin=57, bottomMargin=57,
                            title="WOS收录和分区", author="文绍华")
    doc.build(story, onFirstPage=lambda c, d: _footer(c, d, 0), onLaterPages=lambda c, d: _footer(c, d, 0))


def build_back_section_jcr(path):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.pagesizes import A4
    S = _styles()
    story = [Paragraph("第三部分　JCR分区查询", S["h1"]),
             Paragraph("状态：待补充（申请人说明“还未有”）。", S["body"]),
             Paragraph("本页为占位页，未编造任何分区结论。请申请人登录JCR官网（https://jcr.clarivate.com）查询“Food Chemistry”最新年度分区后，将查询结果页导出为PDF或截图发给经办人，替换本页后重新生成合订本即可。", S["body"]),
             Spacer(1, 8),
             Paragraph("补充步骤：", S["h2"]),
             Paragraph("1. 在JCR中搜索期刊“Food Chemistry”，确认年度与ISSN；", S["body"]),
             Paragraph("2. 将含分区（Quartile）与排名的结果页打印为PDF；", S["body"]),
             Paragraph("3. 把该PDF与本说明一起发给材料经办人，替换本页。", S["body"])]
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=57, rightMargin=57, topMargin=57, bottomMargin=57,
                            title="JCR分区查询（待补充）", author="文绍华")
    doc.build(story, onFirstPage=lambda c, d: _footer(c, d, 0), onLaterPages=lambda c, d: _footer(c, d, 0))


def build_back_section_reason(path):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    S = _styles()
    n = cjk_count(REASON)
    story = [Paragraph("第四部分　申请理由（200字）定稿", S["h1"]),
             Paragraph("以下为已按200字要求写好的申请理由正文（中文字数 %d，含标点），请复制到《附件2：研究生国家奖学金申请审批表》“申请理由”栏；随附的DOCX版审批表已预填本段文字，可直接核对打印。" % n, S["small"]),
             Spacer(1, 4)]
    box = Table([[Paragraph(REASON, S["bodyL"])]], colWidths=[482])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, colors.black),
                             ("INNERPADDING", (0, 0), (-1, -1), 10)]))
    story += [box, Spacer(1, 10),
              Paragraph("写作依据（均出自申请人原件，未编造）：鲁东大学生命科学学院生物学2024级、共青团员；必修9门全及格、综合考评16/29；以共同第一作者在Food Chemistry（SCI升级版农林科学1区，IF 10.4）发表论文；研究内容概括自论文摘要。", S["small"]),
              Paragraph("材料清单：本合订本PDF（封面目录＋论文全文10页＋WOS证明＋JCR占位＋本页）；附件2审批表DOCX（已填理由）；申请理由200字TXT。", S["small"])]
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=57, rightMargin=57, topMargin=57, bottomMargin=57,
                            title="申请理由定稿", author="文绍华")
    doc.build(story, onFirstPage=lambda c, d: _footer(c, d, 0), onLaterPages=lambda c, d: _footer(c, d, 0))


# ---------------- DOCX form ----------------
def _set_run_font(run, ascii_font="Times New Roman", east_asia="SimSun", size_pt=None, bold=None):
    run.font.name = ascii_font
    if size_pt: run.font.size = size_pt
    if bold is not None: run.font.bold = bold
    rPr = run._element.get_or_add_rPr()
    from docx.oxml.ns import qn
    ea = rPr.find(qn("w:eastAsia"))
    if ea is None:
        ea = rPr.makeelement(qn("w:eastAsia"), {})
        rPr.append(ea)
    ea.set(qn("w:val"), east_asia)


def build_docx():
    from docx import Document
    from docx.shared import Pt, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
    doc = Document()
    for sec in doc.sections:
        sec.top_margin = Cm(1.5); sec.bottom_margin = Cm(1.5)
        sec.left_margin = Cm(1.8); sec.right_margin = Cm(1.8)
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"; style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), "SimSun")

    def para(text="", bold=False, size=10.5, align=None, space_after=4):
        p = doc.add_paragraph()
        if align is not None: p.alignment = align
        p.paragraph_format.space_after = Pt(space_after)
        r = p.add_run(text); _set_run_font(r, size_pt=Pt(size), bold=bold)
        return p

    para("附件2：2025－2026学年国家奖学金申请审批表（已填申请理由）", bold=True, size=14, align=WD_ALIGN_PARAGRAPH.CENTER)
    para("说明：本表根据原件重建排版，个人信息照录原件，申请理由已按200字填写；请核对后打印或复制到正式表格。推荐理由等栏目留空待手写。", size=9, space_after=6)
    para("学校：%s　　学号：%s" % (APPLICANT["学校"], APPLICANT["学号"]), size=11)

    def info_table(rows4):
        t = doc.add_table(rows=0, cols=4)
        t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for row in rows4:
            cells = t.add_row().cells
            for i, txt in enumerate(row):
                cells[i].text = ""
                r = cells[i].paragraphs[0].add_run(txt)
                _set_run_font(r, size_pt=Pt(10.5), bold=(i % 2 == 0))
        return t

    para("一、基本情况", bold=True, size=12, space_after=2)
    info_table([
        ["姓名", APPLICANT["姓名"], "性别", APPLICANT["性别"]],
        ["出生年月", APPLICANT["出生年月"], "政治面貌", APPLICANT["政治面貌"]],
        ["民族", APPLICANT["民族"], "入学时间", APPLICANT["入学时间"]],
        ["院系", APPLICANT["院系"], "专业", APPLICANT["专业"]],
        ["学制", APPLICANT["学制"], "年级", APPLICANT["年级"]],
        ["班级", APPLICANT["班级"], "联系电话", APPLICANT["联系电话"]],
        ["身份证号", APPLICANT["身份证号"], "", ""],
    ])
    para("二、学习情况", bold=True, size=12, space_after=2)
    para("成绩排名：19/29（名次/总人数）；实行综合考评排名：是；必修课9门，其中及格以上9门；综合排名：16/29（名次/总人数）。", size=11)
    para("三、主要获奖情况", bold=True, size=12, space_after=2)
    t = doc.add_table(rows=1, cols=3); t.style = "Table Grid"
    hdr = t.rows[0].cells
    for i, h in enumerate(["日期", "奖项名称", "颁奖单位"]):
        hdr[i].text = ""
        r = hdr[i].paragraphs[0].add_run(h); _set_run_font(r, size_pt=Pt(10.5), bold=True)
    for _ in range(3):
        row = t.add_row().cells
        for c in row: c.text = "（空）" if False else ""
    para("四、申请理由（200字）", bold=True, size=12, space_after=2)
    p = doc.add_paragraph()
    r = p.add_run(REASON); _set_run_font(r, size_pt=Pt(11))
    para("申请人签名（手签）：　　　　　　年　　月　　日", size=11)
    para("五、推荐理由（100字）", bold=True, size=12, space_after=2)
    para("（由辅导员或班主任填写）", size=11)
    para("推荐人签名：　　　　　　年　　月　　日", size=11)
    para("六、院（系）意见", bold=True, size=12, space_after=2)
    para("院系主管学生工作领导签名：　　　　　　（院系公章）　　　　　　年　　月　　日", size=11)
    para("七、学校意见", bold=True, size=12, space_after=2)
    para("经评审，并在校内　　月　　日至　　月　　日公示　　个工作日，无异议，现报请批准该同学获得国家奖学金。（学校公章）　　　　　　年　　月　　日", size=11)
    para("制表：全国学生资助管理中心　2023版", size=9)
    doc.save(DOCX_OUT)


def main():
    from pypdf import PdfReader, PdfWriter
    os.makedirs(OUT_DIR, exist_ok=True)
    for p in (PAPER_PDF, WOS_DOCX):
        assert os.path.isfile(p), "missing source: " + p
    _register_fonts()
    wos_img = extract_wos_image()
    tmp = tempfile.mkdtemp(prefix="hebian_")
    wos_pdf = os.path.join(tmp, "wos.pdf"); jcr_pdf = os.path.join(tmp, "jcr.pdf"); rsn_pdf = os.path.join(tmp, "reason.pdf")
    build_back_section_wos(wos_img, wos_pdf)
    build_back_section_jcr(jcr_pdf)
    build_back_section_reason(rsn_pdf)
    n_paper = len(PdfReader(PAPER_PDF).pages)
    n_wos = len(PdfReader(wos_pdf).pages); n_jcr = len(PdfReader(jcr_pdf).pages); n_rsn = len(PdfReader(rsn_pdf).pages)
    # front is cover + toc = 2 pages; renumber back sections with offset
    FRONT = 2
    p_paper = FRONT + 1
    p_wos = p_paper + n_paper
    p_jcr = p_wos + n_wos
    p_rsn = p_jcr + n_jcr
    toc = [("一、成果（论文全文，原样并入）", "第 %d–%d 页" % (p_paper, p_paper + n_paper - 1)),
           ("二、WOS收录和分区证明（含截图）", "第 %d–%d 页" % (p_wos, p_wos + n_wos - 1)),
           ("三、JCR分区查询（待补充·占位页）", "第 %d 页" % p_jcr),
           ("四、申请理由（200字）定稿", "第 %d 页" % p_rsn)]
    front_pdf = os.path.join(tmp, "front.pdf")
    build_front(toc, front_pdf)
    assert len(PdfReader(front_pdf).pages) == FRONT, "front must be 2 pages"
    # stamp back sections with continuous page numbers
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.pagesizes import A4
    def stamp_numbers(src, start_no, dst):
        rd = PdfReader(src); wt = PdfWriter()
        for i, pg in enumerate(rd.pages):
            ov = os.path.join(tmp, "ov%d.pdf" % i)
            c = rl_canvas.Canvas(ov, pagesize=A4)
            c.setFont("SHS", 9); c.setFillColor("#666666")
            # white-out old footer then draw new number
            c.setFillColor("#ffffff"); c.rect(250, 20, 95, 16, stroke=0, fill=1)
            c.setFillColor("#666666"); c.drawCentredString(297.5, 30, "第 %d 页" % (start_no + i))
            c.save()
            base = rd.pages[i]
            base.merge_page(PdfReader(ov).pages[0])
            wt.add_page(base)
        with open(dst, "wb") as f: wt.write(f)
    wos_n = os.path.join(tmp, "wos_n.pdf"); jcr_n = os.path.join(tmp, "jcr_n.pdf"); rsn_n = os.path.join(tmp, "rsn_n.pdf")
    # subset font must be findable by reportlab canvas: already registered
    stamp_numbers(wos_pdf, p_wos, wos_n); stamp_numbers(jcr_pdf, p_jcr, jcr_n); stamp_numbers(rsn_pdf, p_rsn, rsn_n)
    wt = PdfWriter()
    for src in (front_pdf, PAPER_PDF, wos_n, jcr_n, rsn_n):
        for pg in PdfReader(src).pages: wt.add_page(pg)
    wt.add_metadata({"/Title": "2025-2026学年研究生国家奖学金申请支撑材料合订本-文绍华",
                     "/Author": "文绍华", "/Subject": "国家奖学金支撑材料合订本"})
    with open(PDF_OUT, "wb") as f: wt.write(f)
    build_docx()
    with open(TXT_OUT, "w", encoding="utf-8") as f:
        f.write("申请理由（200字）定稿\n\n" + REASON + "\n\n中文字数（含标点）：" + str(cjk_count(REASON))
              + "；全文字符数：" + str(len(REASON)) + "\n说明：请复制正文到附件2“申请理由”栏。\n")
    total = FRONT + n_paper + n_wos + n_jcr + n_rsn
    print("paper=%d wos=%d jcr=%d reason=%d total=%d" % (n_paper, n_wos, n_jcr, n_rsn, total))
    for p in (PDF_OUT, DOCX_OUT, TXT_OUT):
        print("OK", os.path.getsize(p), p)
    os.remove(wos_img)


if __name__ == "__main__":
    main()
