# 大豆萌芽抗抑郁焦虑多肽机器学习项目：进展、问题诊断与实施大纲

> **项目状态说明**：本项目基于包含 278 条多肽（前 ~160 条为阳性样本，160 条之后为负样本，`TYPE` 列标明类别）的训练集 `tai.xlsx`，旨在构建高精度的机器学习模型，并对 30,339 条大豆萌芽多肽进行全库虚拟筛选与抗抑郁构效关系挖掘。

---

## 目录
1. [前期已完成工作梳理 (What Has Been Done)](#1-前期已完成工作梳理-what-has-been-done)
2. [数据结构与正负样本现状解析](#2-数据结构与正负样本现状解析)
3. [核心问题与瓶颈深度诊断 (Why Prediction Fails on Other Antidepressant Peptides)](#3-核心问题与瓶颈深度诊断-why-prediction-fails-on-other-antidepressant-peptides)
4. [下一步完整落地实施方案 (Next Steps & Action Plan)](#4-下一步完整落地实施方案-next-steps--action-plan)
5. [Orange3 实操指南（基于现有 278 条数据）](#5-orange3-实操指南基于现有-278-条数据)
6. [大豆肽全库预测与构效关系挖掘](#6-大豆肽全库预测与构效关系挖掘)

---

## 1. 前期已完成工作梳理 (What Has Been Done)

1. **WSL2 与 Mamba 高性能分析环境就绪**：
   * 在 WSL2 Linux 子系统下，通过 `Mamba` 创建了独立的 `orange3` 环境。
   * 成功配置了 Orange3 GUI 交互环境、PyQt6 渲染引擎以及 Scikit-learn、Pandas、Openpyxl 等科学计算套件。
2. **数据流转与 Git 版本控制打通**：
   * 将 Windows 端的多肽特征表 `E:\0ml\tai.xlsx` 同步挂载到 WSL2 项目目录 `~/projects/peptide-antidepressant-ml/data/`。
   * 初始化 Git 本地仓库，配置 `.gitignore`，并关联远程分支 `arena/019fd721-new`。
3. **特征工程构建完成（37 维理化与药效基序特征）**：
   * 数据集包含 278 条多肽，已提取 38 列信息：
     * **元数据**：`Sequence`（多肽序列，长度 2~32 aa，平均 7.40 aa）。
     * **基础理化特征（9维）**：`Length`, `MW`, `pI`, `Net_charge`, `GRAVY`, `Hydrophobic_ratio`, `Aromatic_ratio`, `Aliphatic_index`, `Instability_index`。
     * **氨基酸单体频率（20维）**：`A_ratio` ~ `W_ratio`。
     * **末端残基（2维）**：`N_terminal_AA`, `C_terminal_AA`。
     * **特异性药效基序与残基簇（6维）**：`YP_motif`, `YGGF_motif`, `YPF_motif`, `YXXF_motif`, `Aromatic_cluster`, `Basic_cluster`。
     * **目标分类标签（1维）**：`TYPE`（前 ~160 条为阳性活性肽，160 条之后为负样本/非活性对照）。
4. **自动化脚本工具链编写**：
   * 编写了 `extract_features.py`，用于对任意未知多肽（包括 30,339 条大豆肽）批量提取与训练集严格对齐的 37 维特征。

---

## 2. 数据结构与正负样本现状解析

你的数据表 `tai.xlsx` 的样本构成特点如下：
* **样本总量**：278 条。
* **正样本（Positive，约 1~160 条）**：主要为具有神经活性/情绪调节/阿片样作用的多肽（如 soymorphin、casomorphin、exorphin、内啡肽/脑啡肽片段等），富集 `YP`、`YGGF`、芳香族氨基酸及特定疏水残基。
* **负样本（Negative，160 条之后）**：非活性/无阿片作用对照肽。
* **标签列 `TYPE`**：已明确区分正样本类别与负样本类别。

---

## 3. 核心问题与瓶颈深度诊断 (Why Prediction Fails on Other Antidepressant Peptides)

你在测试时发现：**“已有数据库里有抗抑郁作用的肽，输入到自己训练的模型里却预测为没有抗抑郁作用（假阴性）”**。深入剖析其底层原因有以下 4 点：

### 3.1 机制单一性与靶点偏倚（最大的根本原因）
* **现状**：150 条阳性肽中，绝大多数来源于**阿片受体（$\mu$/$\delta$-Opioid Receptor）**激动多肽。
* **矛盾点**：抗抑郁焦虑在中枢神经系统涉及多条不同通路：
  1. **阿片通路**（如 Soymorphin，富含 N端 Tyr-Pro、YGGF 模式）；
  2. **GABA 能通路**（如某些富含 Leu/Ile/Val 疏水性且 C 端带 Lys/Arg 的肽）；
  3. **5-HT1A / 突触素 / BDNF 模拟通路**（具有特定正电荷与芳香族堆叠空间排列）；
  4. **外周抗神经炎症与脑肠轴通路**。
* **结论**：如果外部数据库里的抗抑郁肽是走 **GABA、5-HT 或神经保护** 途径的，它们天然不具备 N端 Tyr-Pro 等阿片样强基序。模型基于这 150 条阿片特征训练，必然会把它们判为“无活性”。**这并不代表模型错了，而是该模型当前本质上是一个“阿片样抗抑郁亚型分类器”。**

### 3.2 特征维度与小样本过拟合风险（Curse of Dimensionality）
* 阳性样本 160 条，特征维度达到了 37 维。
* 如果随机森林没有做剪枝（例如未限制 `max_depth`，或树数量过多），模型会对 160 条样本中偶然出现的氨基酸组合产生过强记忆，导致泛化能力下降。

### 3.3 0.5 默认硬分类阈值的误杀
* 机器学习模型输出的是连续的后验概率值（0.0 ~ 1.0）。
* 外部抗抑郁肽可能因为特征差异，模型给出了 `0.42` 或 `0.48` 的高倾向概率，但因为默认以 `0.50` 作为截断值，被系统一刀切判定为“0（无活性）”。

### 3.4 负样本的纯度与特征边界
* 160 条之后的负样本如果是来自普通蛋白片段，模型学到的边界其实是“阿片特征 vs 普通片段”。如果负样本中存在潜在具有其他神经活性的多肽，会导致决策边界变形。

---

## 4. 下一步完整落地实施方案 (Next Steps & Action Plan)

为了彻底解决上述问题，并顺利完成 30,339 条大豆萌芽肽的筛选和 SCI 论文撰写，建议执行以下技术路线：

```
                    ┌── 1. 模型定位明晰：将 ML 模型正式定义为「阿片/情绪调节活性预测器」
                    ├── 2. 多靶点互补：引入 GABA、BDNF、抗炎、抗氧化等规则与代理模型（6维活性谱）
解决思路与技术路线 ──┼── 3. 模型升级调优：Orange3 中对比 4 种算法 + 10折交叉验证 + 软概率输出
                    ├── 4. 全库大豆肽预测：提取 37 维特征，计算 FOS 多靶点功能叠加度得分
                    └── 5. 构效关系与机制验证：SHAP 特征贡献度 + PWM WebLogo + 受体分子对接
```

### 4.1 方案 A：多靶点功能融合打分（推荐，完全闭环）
不要期望用一个单模型解决所有抑郁机制，而是采用你设计的 **6 维活性谱系统**：
1. **维度 ④（阿片样/情绪调节）**：直接使用你的 278 条正负样本训练的 **机器学习模型** 输出概率 $P_{\text{opioid}}$。
2. **维度 ⑤（GABA 调节）**：采用规则标签（疏水性 $\ge 40\%$ 且 C端含 Lys/Arg）。
3. **维度 ⑥（神经保护/BDNF）**：采用规则标签（含 Trp 或芳香族 $\ge 2$ 且正负电荷比 $\ge 1.2$）。
4. **维度 ①②③（外周与脑肠轴）**：ACE 抑制 + 抗氧化 + 抗炎评分。
5. **最终排序**：通过 **FOS（Functional Overlap Score）** 综合筛选，找出同时在阿片、GABA、抗炎、抗氧化等多维度兼具高分的 **Tier 1 (Top 50)** 大豆肽！

---

## 5. Orange3 实操指南（基于现有 278 条数据）

由于你的 `tai.xlsx` 已经包含了正负样本和 `TYPE` 标签，可以直接在 Orange3 中进行标准建模与验证：

### 步骤 1：载入数据与指定列角色（Column Roles）
1. 启动 Orange3：
   ```bash
   conda activate orange3
   orange-canvas
   ```
2. 拖入 **`File`** 控件，载入 `./data/tai.xlsx`。
3. 双击打开 `File` 控件，严格配置以下列角色：
   * **`Sequence`** $\rightarrow$ **`meta`**（元数据，仅用于展示，不参与计算）。
   * **`TYPE`** $\rightarrow$ **`target`**（因变量/分类目标）。
   * **`N_terminal_AA`**, **`C_terminal_AA`** $\rightarrow$ `Categorical`, **`feature`**。
   * 其余所有列（`Length`, `MW`, `GRAVY`, `A_ratio` ... `Basic_cluster`） $\rightarrow$ `Numeric`, **`feature`**。
4. 点击 **`Apply`**。

### 步骤 2：多算法对比与 10 折交叉验证
1. 拖入算法控件：
   * **`Random Forest`**（参数建议：Number of trees = 100, 可勾选限制深度 Limit depth = 5~8 避免过拟合）。
   * **`SVM`**（核函数选择 RBF 或 Linear）。
   * **`Gradient Boosting`**（树深度 3，学习率 0.1）。
   * **`Logistic Regression`**（L2 正则化）。
2. 拖入 **`Test and Score`** 控件：
   * 将 `File` 控件和上述所有算法控件连接到 `Test and Score`。
   * 在 `Test and Score` 中勾选 **`Cross validation`**（Number of folds = 10）。
   * 记录 **AUC、CA（准确率）、F1-score、Precision、Recall**（用于论文表格）。
3. 拖入 **`ROC Analysis`** 和 **`Confusion Matrix`** 观察模型在正负样本上的识别率与混淆情况。

### 步骤 3：特征重要性提取（构效关系支撑）
1. 拖入 **`Rank`** 控件，将 `File` 控件连接到 `Rank`。
2. 打开 `Rank`，按 **Information Gain（信息增益）** 排序，查看哪些特征（如 `YP_motif`、`Aromatic_ratio`、`GRAVY` 等）对区分正负样本起决定性作用。

---

## 6. 大豆肽全库预测与构效关系挖掘

### 步骤 1：批量提取 30,339 条大豆肽的 37 维特征
在 WSL2 终端中运行：
```bash
python extract_features.py ./data/soy_peptides.xlsx ./data/soy_features.xlsx
```

### 步骤 2：在 Orange3 中输出全库预测概率并筛选
1. 拖入第二个 **`File`** 控件（载入 `soy_features.xlsx`，将 `Sequence` 设为 `meta`，其余 37 维设为 `feature`）。
2. 拖入 **`Predictions`** 控件：
   * 将表现最优的模型（如 `Random Forest`）连接到 `Predictions`。
   * 将载入大豆肽的 `File` 控件连接到 `Predictions`。
3. 双击 `Predictions`，即可看到全库大豆肽被预测为活性的具体概率值（`Probability of ACTIVE`）。
4. 连接 **`Select Rows`** 控件，设置过滤条件：
   * `Probability of ACTIVE >= 0.60`（或根据分数分布选取 Top 100）。
5. 连接 **`Save Data`** 导出候选大豆肽表 `soy_antidepressant_candidates.xlsx`。

---

## 7. 常见问题答疑速查 (FAQ)

* **Q：为什么预测概率不用 0.5 作为唯一死标准？**
  * A：在多肽虚拟筛选中，通常采用 **Top-N 排序法** 或 **连续概率输出**，概率值代表该肽具有阿片样抗抑郁构象的置信度。配合 FOS 多靶点体系打分，能有效避免单一靶点导致的假阴性漏筛。
* **Q：论文中如何向审稿人解释“只有150条抗抑郁肽”？**
  * A：明确说明：“抗抑郁多肽在中枢神经靶点上主要由外啡肽/阿片调节肽代表，本研究基于已验证的神经活性肽段构建基准模型，并创新性地融合 GABA、BDNF 模拟规则与外周脑肠轴抗炎/抗氧化指标，形成了多靶点协同筛选体系。” 这在 SCI 审稿中是非常成熟且受认可的表述方式。
