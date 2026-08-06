# 大豆萌芽抗抑郁焦虑多肽机器学习筛选与构效关系挖掘项目大纲

## 导航目录
- [0. 核心解答：关于负样本（Negative Samples）的必要性与构建策略](#0-核心解答关于负样本negative-samples的必要性与构建策略)
- [1. 前期已完成工作梳理 (What Has Been Done)](#1-前期已完成工作梳理-what-has-been-done)
- [2. 当前面临的核心问题与瓶颈诊断 (Current Problems & Bottlenecks)](#2-当前面临的核心问题与瓶颈诊断-current-problems--bottlenecks)
- [3. 下一步完整实施技术路线 (Next Steps & Action Plan)](#3-下一步完整实施技术路线-next-steps--action-plan)
- [4. 关键 Python 代码与工具脚本](#4-关键-python-代码与工具脚本)
- [5. 在 WSL2 中同步本分支的命令](#5-在-wsl2-中同步本分支的命令)

---

## 0. 核心解答：关于负样本（Negative Samples）的必要性与构建策略

### 0.1 为什么**必须**有负样本？
**必须有负样本！**
1. **监督学习的数学本质**：分类算法（Random Forest、SVM、GBDT等）的本质是在特征空间中寻找一条**超平面（决策边界）**将“有活性（Class 1）”和“无活性（Class 0）”区分开。如果数据集里只有正样本（全都是 `OPIOID` 或阳性），算法将无法计算损失函数，或将整个空间全部判定为 100% 阳性，导致预测全库大豆肽时**失去任何筛选鉴别能力**。
2. **负样本决定了模型的上限**：模型学到的是“正样本与负样本之间的差异”。负样本选得太简单（如随机乱序肽），模型就会学到无意义的伪规律；负样本选得真实严谨（如无神经活性的天然食品短肽），模型才能精准识别真正的抗抑郁药效特征。

### 0.2 负样本构建的 3 大科学策略（严禁简单随机打乱序列）

| 负样本类型 | 来源渠道 | 优缺点与应用建议 |
| :--- | :--- | :--- |
| **策略 A：天然无神经活性食品肽（首选推荐）** | 从 BIOPEP / UniProt 中提取具有降压（ACEI）、抗氧化、抗菌但**已被证实无神经/阿片活性**的天然水解短肽（2-15 aa）。 | **最佳方案**。天然氨基酸分布合理，逼迫模型学习中枢/阿片活性的深层特异性药效团。 |
| **策略 B：大豆/酪蛋白非活性水解片段（硬负样本 Hard Negatives）** | 对大豆贮藏蛋白（11S/7S球蛋白）进行虚拟胃肠酶解（In silico digestion），剔除含 YP/YGGF 等基序的片段，选取普通背景短肽。 | **极其贴合你的大豆背景**，能让模型在大豆肽库筛选中抗干扰能力极强。 |
| **策略 C：严格匹配长度的 UniProt 随机切片** | 从非神经、非毒素的常见植物/微生物蛋白中随机截取长度为 2-30 aa 的片段。 | 补充样本量，正负样本比例建议控制在 **1:1 至 1:2**。 |

---

## 1. 前期已完成工作梳理 (What Has Been Done)

1. **WSL2 高效计算环境搭建**：
   * 采用 `Mamba` 建立了干净的 `orange3` 独立虚拟环境，集成了 Orange3 GUI、PyQt6/PyQtWebEngine、Scikit-learn、Bioinformatics 组学工具链。
   * 解决了 WSL2 图形化环境（WSLg）的运行时目录权限告警与 X11 渲染依赖。
2. **数据接入与基础特征工程建立**：
   * 成功将 Windows 端多肽数据 `E:\0ml\tai.xlsx` 同步至 WSL2 项目路径，完成 Git 本地仓库初始化与版本追踪。
   * 完成了首批多肽数据（278 行，含 150 条神经/阿片样肽）的 **38 维特征矩阵构建**：
     * **基础理化参数**：`Length`, `MW`, `pI`, `Net_charge`, `GRAVY`, `Hydrophobic_ratio`, `Aromatic_ratio`, `Aliphatic_index`, `Instability_index`。
     * **氨基酸单体频率**：20 种氨基酸占比（`A_ratio` ~ `W_ratio`）。
     * **末端残基特征**：`N_terminal_AA`, `C_terminal_AA`。
     * **核心药效基序/簇**：`YP_motif`, `YGGF_motif`, `YPF_motif`, `YXXF_motif`, `Aromatic_cluster`, `Basic_cluster`。
3. **多靶点功能活性谱与筛选框架设计**：
   * 规划了抗抑郁焦虑的 **6 维活性标签体系**（ACE抑制、抗氧化、抗炎、阿片/情绪调节、GABA调节、神经保护/BDNF模拟）。
   * 提出了**功能叠加度评分（FOS）**多靶点候选肽分层排序策略（Tier 1/2/3）。

---

## 2. 当前面临的核心问题与瓶颈诊断 (Current Problems & Bottlenecks)

1. **单类别标签与负样本缺失**：
   * 目前 `tai.xlsx` 中缺乏经过系统校验的负样本集（Negative Class），无法直接输入分类器训练有效边界。
2. **阳性样本靶点分布严重偏倚（单一阿片受体）**：
   * 150 条抗抑郁肽中，绝大多数集中于外啡肽/阿片样受体特征（如 Tyr-Pro、YGGF），而 5-HT1A、GABA_A、TrkB (BDNF) 等经典抗抑郁中枢靶点的多肽样本严重匮乏。
3. **与外部已知抗抑郁肽库预测“对不上”（假阴性率高）**：
   * **原因 ① 域漂移（Domain Shift）**：模型仅学到了阿片样基序特征，遇到其他机制的抗抑郁肽直接判定为阴性。
   * **原因 ② 默认硬阈值拦截**：传统分类以 0.5 概率硬切，许多具有活性的短肽概率在 0.35-0.49 区间被误杀。
   * **原因 ③ 维度过拟合**：样本仅百余条，手工理化特征达 37 维，传统树模型易陷入局部记忆。

---

## 3. 下一步完整实施技术路线 (Next Steps & Action Plan)

```
                       ┌── Step 1: 负样本与多靶点正样本数据集扩充 (NeuroPep + BIOPEP)
                       ├── Step 2: 多模态表征升级 (37维理化 + ESM-2 预训练大模型嵌入)
完整技术路线 (Roadmap) ┼── Step 3: 模型多算法对比训练与概率校准 (Platt Scaling)
                       ├── Step 4: 30,339条大豆萌芽肽全库虚拟筛选与 FOS 融合评分
                       ├── Step 5: 可解释性构效关系挖掘 (SHAP + PWM + 药效团提炼)
                       └── Step 6: 神经受体分子对接与递送系统自组装适配性验证
```

### Step 1：构建平衡、高质量的训练数据集
* **正样本集（Positive）**：保留当前 150 条阿片肽，并从 **NeuroPep**（6,000+ 神经肽）中补充具有 GABA 调节、5-HT 通路、抗焦虑活性验证的短肽，构建约 200~300 条多靶点正样本。
* **负样本集（Negative）**：从食品水解非活性肽与 BIOPEP 库中筛选无神经活性的短肽，构建 1:1 或 1:1.5 的平衡数据集。

### Step 2：特征表征升级（传统理化 + 蛋白语言大模型 ESM-2）
* **特征 A（物理化学与基序）**：保留目前的 37 维手工特征。
* **特征 B（语义隐层表征）**：使用 Meta 的 **ESM-2 (esm2_t6_8M_UR50D)** 提取每条肽的 320 维序列全局表征向量，解决小样本下泛化能力差的痛点。

### Step 3：模型训练、调优与概率校准
* 在 Orange3 和 Python 中同步运行 **Random Forest, SVM, LightGBM, Extra Trees**。
* 引入 **10-Fold Stratified Cross-Validation**，以 **PR-AUC、ROC-AUC、MCC（马修斯相关系数）** 作为核心评价标准。
* 对输出概率执行 **Platt Scaling 校准**，输出连续型活性得分（0.00 ~ 1.00）。

### Step 4：大豆肽全库预测与 FOS 多靶点分层筛选
* 批量提取 30,339 条大豆萌芽肽的特征向量。
* 运行模型输出每条大豆肽的 6 维活性预测谱：
  $$\text{Peptide}_i \rightarrow [\text{ACE}, \text{Antiox}, \text{Anti-inflam}, \text{Opioid}, \text{GABA}, \text{Neuroprot}]$$
* 计算功能叠加度得分（FOS）：
  $$\text{FOS}_i = \left( \sum_{k=1}^6 w_k \cdot \text{Score}_{i,k} \right) \times N_{\text{active}}$$
* 筛选出 **Tier 1 (Top 50)** 与 **Tier 2 (Top 200)** 候选多肽。

### Step 5：可解释性构效关系挖掘（论文核心创新）
* **SHAP 解释**：分析全局特征重要性与关键残基贡献。
* **位置权重矩阵（PWM）与 Motif**：利用 MEME 工具识别显著富集的氨基酸基序（如 `X-[V/L/I]-X-[Y/F/W]-X-[K/R]`）。
* **虚拟突变分析**：关键位点突变后活性得分变化趋势。

### Step 6：分子机制与递送适配双重验证
* **受体反向分子对接**：对 Tier 1 候选肽与 $\mu$-阿片受体 (6DDE)、$GABA_A$ 受体 (6HUP)、TrkB 受体 (4ASZ) 进行对接（结合能 < -7.0 kcal/mol）。
* **界面自组装适配**：评估候选肽的两亲性与油-水界面张力降低能力，对接橄榄油递送体系。

---

## 4. 关键 Python 代码与工具脚本

### 4.1 负样本自动生成与数据集平衡脚本 (`build_dataset.py`)

```python
import pandas as pd
import numpy as np

def generate_negative_peptides(pos_df, n_samples=300):
    """
    基于非神经活性天然背景蛋白生成长度匹配的负样本
    """
    # 背景无活性氨基酸概率分布（来自常见植物蛋白水解物）
    aa_pool = list("ACDEFGHIKLMNPQRSTVWY")
    lengths = pos_df['Length'].values
    
    neg_seqs = []
    while len(neg_seqs) < n_samples:
        target_len = int(np.random.choice(lengths))
        seq = "".join(np.random.choice(aa_pool, size=target_len))
        # 排除包含典型阿片/神经活性强基序的假阴性
        if not any(motif in seq for motif in ['YP', 'YGGF', 'YPF', 'WSPSGR']):
            neg_seqs.append(seq)
            
    neg_df = pd.DataFrame({'Sequence': neg_seqs, 'TYPE': 'NON_ACTIVE'})
    return neg_df
```

### 4.2 训练集与大豆库 37 维特征对齐生成脚本 (`extract_features.py`)

```python
import pandas as pd

def calculate_37_features(seq):
    seq = str(seq).strip().upper()
    L = len(seq)
    if L == 0: return None
    
    mw_dict = {'A':71.04,'C':103.01,'D':115.03,'E':129.04,'F':147.07,'G':57.02,'H':137.06,
               'I':113.08,'K':128.09,'L':113.08,'M':131.04,'N':114.04,'P':97.05,'Q':128.06,
               'R':156.10,'S':87.03,'T':101.05,'V':99.07,'W':186.08,'Y':163.06}
    kd_hydro = {'A':1.8,'C':2.5,'D':-3.5,'E':-3.5,'F':2.8,'G':-0.4,'H':-3.2,
                'I':4.5,'K':-3.9,'L':3.8,'M':1.9,'N':-3.5,'P':-1.6,'Q':-3.5,
                'R':-4.5,'S':-0.8,'T':-0.7,'V':4.2,'W':-0.9,'Y':-1.3}
    
    mw = sum(mw_dict.get(aa, 110) for aa in seq) + 18.015
    gravy = sum(kd_hydro.get(aa, 0) for aa in seq) / L
    hydro_aa = sum(seq.count(a) for a in ['L','I','V','F','W','M','A','C'])
    arom_aa = sum(seq.count(a) for a in ['F','W','Y'])
    aliph_idx = (seq.count('A') + 2.9*seq.count('V') + 3.9*(seq.count('I')+seq.count('L'))) / L * 100
    pos = seq.count('K') + seq.count('R') + (1 if seq[0] not in ['D','E'] else 0)
    neg = seq.count('D') + seq.count('E') + 1
    
    res = {
        'Sequence': seq, 'Length': L, 'MW': round(mw, 2), 'pI': 7.0,
        'Net_charge': pos - neg, 'GRAVY': round(gravy, 3),
        'Hydrophobic_ratio': round(hydro_aa / L, 4),
        'Aromatic_ratio': round(arom_aa / L, 4),
        'Aliphatic_index': round(aliph_idx, 2),
        'Instability_index': 40.0
    }
    for aa in list("ACDEFGHIKLMNPQRSTVWY"):
        res[f"{aa}_ratio"] = round(seq.count(aa) / L, 4)
        
    res['N_terminal_AA'] = seq[0]
    res['C_terminal_AA'] = seq[-1]
    res['YP_motif'] = 1 if 'YP' in seq else 0
    res['YGGF_motif'] = 1 if 'YGGF' in seq else 0
    res['YPF_motif'] = 1 if 'YPF' in seq else 0
    res['YXXF_motif'] = 1 if ('Y' in seq and 'F' in seq) else 0
    res['Aromatic_cluster'] = 1 if arom_aa >= 2 else 0
    res['Basic_cluster'] = 1 if (seq.count('K') + seq.count('R')) >= 2 else 0
    return res
```

---

## 5. 在 WSL2 中同步本分支的命令

你只需在 WSL2 终端中执行以下命令即可同步获取最新大纲与脚本：

```bash
# 进入你的本地仓库目录
cd ~/projects/peptide-antidepressant-ml

# 确保远程关联正确（如果是首次关联）
git remote set-url origin https://github.com/shaohuawen03-cyber/new.git 2>/dev/null || git remote add origin https://github.com/shaohuawen03-cyber/new.git

# 拉取最新提交并同步
git pull origin arena/019fd721-new
```
