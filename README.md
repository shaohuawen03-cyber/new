# 大豆萌芽抗抑郁焦虑多肽机器学习筛选与构效关系挖掘项目

本项目基于包含 278 条多肽样本（前 ~160 条为阳性活性肽，160 条之后为负样本/非活性对照，`TYPE` 列标明类别）的数据集 `tai.xlsx`，旨在通过 Orange3 与 Python 构建高精度的机器学习模型，并对 30,339 条大豆萌芽多肽进行全库虚拟筛选与抗抑郁构效关系挖掘。

---

## 核心文档与代码导航

1. **[项目进展、问题诊断与完整大纲 (PROJECT_STATUS_AND_PROBLEM_ANALYSIS.md)](PROJECT_STATUS_AND_PROBLEM_ANALYSIS.md)**
   * **已完成工作**：WSL2 + Mamba 环境搭建、38 维特征矩阵解析（37 维理化/基序特征 + 1 维 `TYPE` 标签）。
   * **核心问题诊断**：为什么已有数据库中部分抗抑郁肽被判为无活性（阿片样单一靶点偏倚、0.5硬阈值截断、小样本维度过拟合深度剖析）。
   * **下一步完整方案**：Orange3 多模型训练（RF, SVM, GBDT）+ 10折交叉验证 + 6维活性谱与 FOS 多靶点融合筛选 + 构效关系（SHAP/PWM）提炼。
2. **[extract_features.py](extract_features.py)**
   * 批量计算多肽 37 维理化与药效基序特征的自动化工具，用于将 30,339 条大豆肽处理为与训练集完全对齐的表格。
3. **[build_dataset.py](build_dataset.py)**
   * 负样本自动扩增与平衡数据集构建脚本（备用，用于扩充或补充特定背景负样本）。

---

## 在 WSL2 中一键同步本分支

在你的 WSL2 终端中运行：

```bash
# 1. 进入项目目录
cd ~/projects/peptide-antidepressant-ml

# 2. 如果尚未关联远程仓库，先执行关联（若已关联可忽略）
git remote add origin https://github.com/shaohuawen03-cyber/new.git 2>/dev/null || true

# 3. 从远程分支拉取并合并最新大纲与代码
git pull origin arena/019fd721-new --allow-unrelated-histories --no-rebase
```

---

## Orange3 快速实操步骤

1. 启动 Orange：
   ```bash
   conda activate orange3
   orange-canvas
   ```
2. 拖入 **`File`** 控件，载入 `./data/tai.xlsx`：
   * 将 `Sequence` 设置为 **`meta`**
   * 将 `TYPE` 设置为 **`target`**
   * 其余所有列设为 **`feature`**
3. 连接 **`Random Forest`**, **`SVM`**, **`Gradient Boosting`** 到 **`Test and Score`** 进行 10 折交叉验证。
4. 使用 `extract_features.py` 处理大豆肽库，并通过 **`Predictions`** 控件进行全库高通量虚拟筛选。
