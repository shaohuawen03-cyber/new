# -*- coding: utf-8 -*-
"""Build the scholarship deliverables v2 (合订本PDF + 理由TXT).

v2 changes: merged PDF drops Part 4 (reason page); JCR section embeds the
user's screenshot once sources/JCR分区查询截图.png arrives (until then a
clearly-labeled pending box, no fabricated claims); the rebuilt DOCX form is
REMOVED (user requires the ORIGINAL .doc format -> fill locally with
code/fill_reason.ps1 which uses Word/WPS COM on the real .doc).

Inputs (from user's upload): sources/*.pdf/.docx/.doc/.png
Outputs (committed to git):
  deliverable/国家奖学金支撑材料合订本_文绍华.pdf
  deliverable/申请理由200字.txt   (also the fill source for fill_reason.ps1)

Fonts: code/fonts/SHS-R-sub.ttf / SHS-B-sub.ttf (subset of SourceHanSansCN,
built from THIS file's text via pyftsubset).
Run:  .venv/bin/python code/build_deliverable.py
"""
import os, re, zipfile, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(REPO, "sources")
OUT_DIR = os.path.join(REPO, "deliverable")
FONTS_DIR = os.path.join(REPO, "code", "fonts")

PAPER_PDF = os.path.join(SRC_DIR, "Combined computational and spectroscopic analyses of the interactions between ginger compounds and bovine type I collagen.pdf")
WOS_DOCX = os.path.join(SRC_DIR, "文字文稿1.docx")
JCR_CANDIDATES = ["JCR分区查询截图.png", "jcr.png", "JCR.png", "jcr截图.png"]

def find_jcr_image():
    for name in JCR_CANDIDATES:
        p = os.path.join(SRC_DIR, name)
        if os.path.isfile(p):
            return p
    return None

JCR_IMG = None  # resolved in main() via find_jcr_image()
PDF_OUT = os.path.join(OUT_DIR, "国家奖学金支撑材料合订本_文绍华.pdf")
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

JCR_INFO = [
    ("期刊", "Food Chemistry"),
    ("JCR年度", "2025（截图左上角 JCR Year）"),
    ("收录版本", "Science Citation Index Expanded (SCIE)"),
    ("ISSN / eISSN", "0308-8146 / 1873-7072"),
    ("JCR缩写 / ISO缩写", "FOOD CHEM / Food Chem."),
    ("学科类别", "NUTRITION & DIETETICS；CHEMISTRY, APPLIED；FOOD SCIENCE & TECHNOLOGY"),
    ("语种 / 地区", "English / ENGLAND"),
    ("出版商", "ELSEVIER SCI LTD（125 London Wall, London EC2Y 5AS, ENGLAND）"),
    ("出版频率", "24 issues/year"),
    ("插件标签", "农林科学TOP；EI检索；SCI升级版农林科学1区；SCI基础版工程技术2区；IF 10.4；SWJTU A+（截图中的浏览器插件标注）"),
]

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
    story.append(Paragraph("本合订本收录：目录 — 成果（论文全文）— WOS收录和分区证明 — JCR分区查询。", S["body"]))
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


def build_back_section_jcr(path, jcr_img):
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    S = _styles()
    story = [Paragraph("第三部分　JCR分区查询", S["h1"])]
    if jcr_img and os.path.isfile(jcr_img):
        story.append(Paragraph("来源：申请人提供的JCR期刊主页截图（原样嵌入下图）", S["small"]))
        rows = [[Paragraph("<b>%s</b>" % k, S["cellB"]), Paragraph(v, S["cell"])] for k, v in JCR_INFO]
        t = Table(rows, colWidths=[150, 332])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                               ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f2f2f2"))]))
        h2tight = ParagraphStyle("h2tight2", parent=S["h2"], spaceBefore=2, spaceAfter=2)
        story += [t, Spacer(1, 2), Paragraph("JCR期刊主页截图（原件）：", h2tight)]
        from PIL import Image as PILImage
        iw, ih = PILImage.open(jcr_img).size
        w, h = 460, 460 * ih / iw
        if h > 380:
            w, h = w * 380 / h, 380
        story.append(Image(jcr_img, width=w, height=h))
        story.append(Spacer(1, 10))
        story.append(Paragraph("声明：上图为申请人提供的JCR截图；其中彩色标签为浏览器学术插件标注。本截图为期刊主页头部，未含JCR分区表（Quartile／Rank）部分，此处不编造分区结论；如需完整分区排名，可再补一张含排名的截图。", S["small"]))
        title = "JCR分区查询"
    else:
        story += [Paragraph("状态：截图文件待收入（申请人已提供截图预览，待截图文件经上传收入后即嵌入本页）。", S["body"]),
                  Paragraph("本页暂为说明页，未编造任何分区结论。请申请人把JCR截图保存为 jcr.png 放入 sources 文件夹后执行推送，下一版合订本将原样嵌入截图并附期刊信息表。", S["body"]),
                  Spacer(1, 8),
                  Paragraph("推送方法（在本机克隆里执行）：", S["h2"]),
                  Paragraph("文件已在 sources 文件夹内时，直接执行：.\\push.ps1 \"upload: jcr screenshot\"", S["body"])]
        title = "JCR分区查询（截图待嵌入）"
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=57, rightMargin=57, topMargin=57, bottomMargin=57,
                            title=title, author="文绍华")
    doc.build(story, onFirstPage=lambda c, d: _footer(c, d, 0), onLaterPages=lambda c, d: _footer(c, d, 0))


def main():
    from pypdf import PdfReader, PdfWriter
    os.makedirs(OUT_DIR, exist_ok=True)
    for p in (PAPER_PDF, WOS_DOCX):
        assert os.path.isfile(p), "missing source: " + p
    _register_fonts()
    wos_img = extract_wos_image()
    tmp = tempfile.mkdtemp(prefix="hebian_")
    jcr_img = find_jcr_image()
    wos_pdf = os.path.join(tmp, "wos.pdf"); jcr_pdf = os.path.join(tmp, "jcr.pdf")
    build_back_section_wos(wos_img, wos_pdf)
    build_back_section_jcr(jcr_pdf, jcr_img)
    n_paper = len(PdfReader(PAPER_PDF).pages)
    n_wos = len(PdfReader(wos_pdf).pages); n_jcr = len(PdfReader(jcr_pdf).pages)
    # front is cover + toc = 2 pages; renumber back sections with offset
    FRONT = 2
    p_paper = FRONT + 1
    p_wos = p_paper + n_paper
    p_jcr = p_wos + n_wos
    jcr_label = "三、JCR分区查询（含截图）" if jcr_img else "三、JCR分区查询（截图待嵌入）"
    def pg_range(start, n):
        return "第 %d–%d 页" % (start, start + n - 1) if n > 1 else "第 %d 页" % start
    toc = [("一、成果（论文全文，原样并入）", pg_range(p_paper, n_paper)),
           ("二、WOS收录和分区证明（含截图）", pg_range(p_wos, n_wos)),
           (jcr_label, pg_range(p_jcr, n_jcr))]
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
    wos_n = os.path.join(tmp, "wos_n.pdf"); jcr_n = os.path.join(tmp, "jcr_n.pdf")
    # subset font must be findable by reportlab canvas: already registered
    stamp_numbers(wos_pdf, p_wos, wos_n); stamp_numbers(jcr_pdf, p_jcr, jcr_n)
    wt = PdfWriter()
    for src in (front_pdf, PAPER_PDF, wos_n, jcr_n):
        for pg in PdfReader(src).pages: wt.add_page(pg)
    wt.add_metadata({"/Title": "2025-2026学年研究生国家奖学金申请支撑材料合订本-文绍华",
                     "/Author": "文绍华", "/Subject": "国家奖学金支撑材料合订本"})
    with open(PDF_OUT, "wb") as f: wt.write(f)
    with open(TXT_OUT, "w", encoding="utf-8") as f:
        f.write("申请理由（200字）定稿\n\n" + REASON + "\n\n中文字数（含标点）：" + str(cjk_count(REASON))
              + "；全文字符数：" + str(len(REASON))
              + "\n说明：本文件第3行为填表数据源，请在本机运行 code\\fill_reason.ps1 自动填入原表；也可手动复制正文到附件2“申请理由”栏。\n")
    total = FRONT + n_paper + n_wos + n_jcr
    print("paper=%d wos=%d jcr=%d total=%d jcr_img=%s" % (n_paper, n_wos, n_jcr, total, jcr_img))
    for p in (PDF_OUT, TXT_OUT):
        print("OK", os.path.getsize(p), p)
    os.remove(wos_img)


if __name__ == "__main__":
    main()
