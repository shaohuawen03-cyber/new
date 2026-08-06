"""
build_dataset.py - 构建平衡正负样本数据集工具
用于根据现有阳性肽数据（如 tai.xlsx），自动匹配生成严格长度/理化对应的负样本，输出供 Orange3 训练的平衡数据集。
"""

import sys
import os
import pandas as pd
import numpy as np
from extract_features import calculate_37_features

def build_balanced_dataset(pos_excel_path, output_path, neg_ratio=1.0):
    print(f"正在读取阳性数据集: {pos_excel_path} ...")
    df_pos = pd.read_excel(pos_excel_path)
    
    # 确定阳性样本序列
    seq_col = [c for c in df_pos.columns if any(k in str(c).lower() for k in ['seq', 'peptide', '序列', '肽'])][0]
    pos_seqs = df_pos[seq_col].dropna().astype(str).str.strip().str.upper().unique().tolist()
    print(f"提取到唯一阳性肽条数: {len(pos_seqs)}")
    
    # 统计阳性肽长度分布
    lengths = [len(s) for s in pos_seqs]
    n_neg = int(len(pos_seqs) * neg_ratio)
    print(f"计划生成负样本条数 (比例 1:{neg_ratio}): {n_neg} 条")
    
    # 天然植物蛋白常见氨基酸背景频率 (Soybean / UniProt Background)
    aa_weights = {
        'A': 0.0825, 'R': 0.0553, 'N': 0.0406, 'D': 0.0545, 'C': 0.0137,
        'Q': 0.0393, 'E': 0.0675, 'G': 0.0707, 'H': 0.0227, 'I': 0.0596,
        'L': 0.0966, 'K': 0.0584, 'M': 0.0242, 'F': 0.0386, 'P': 0.0470,
        'S': 0.0656, 'T': 0.0534, 'W': 0.0108, 'Y': 0.0292, 'V': 0.0687
    }
    aas = list(aa_weights.keys())
    probs = [aa_weights[a] for a in aas]
    probs = [p / sum(probs) for p in probs]
    
    np.random.seed(42)
    neg_seqs = set()
    pos_set = set(pos_seqs)
    
    while len(neg_seqs) < n_neg:
        target_len = int(np.random.choice(lengths))
        seq = "".join(np.random.choice(aas, p=probs, size=target_len))
        
        # 排除包含已知强神经活性/阿片样基序的假阴性
        if any(motif in seq for motif in ['YP', 'YGGF', 'YPF', 'WSPSGR']):
            continue
        if seq in pos_set or seq in neg_seqs:
            continue
            
        neg_seqs.add(seq)
        
    print(f"负样本生成完毕！正在提取 37 维特征...")
    
    # 组装完整数据集
    all_rows = []
    # 1. 阳性数据
    for s in pos_seqs:
        f = calculate_37_features(s)
        if f:
            f['TYPE'] = 'ACTIVE'
            all_rows.append(f)
            
    # 2. 负样本数据
    for s in neg_seqs:
        f = calculate_37_features(s)
        if f:
            f['TYPE'] = 'NON_ACTIVE'
            all_rows.append(f)
            
    df_balanced = pd.DataFrame(all_rows)
    print(f"平衡数据集构建完成: 共 {len(df_balanced)} 行 (阳性: {len(pos_seqs)}, 阴性: {len(neg_seqs)})")
    
    if output_path.endswith('.csv'):
        df_balanced.to_csv(output_path, index=False)
    else:
        df_balanced.to_excel(output_path, index=False)
    print(f"已保存至: {output_path}，可在 Orange3 中直接载入训练！")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        build_balanced_dataset(sys.argv[1], sys.argv[2])
    else:
        print("用法示例: python build_dataset.py ./data/tai.xlsx ./data/tai_balanced_train.xlsx")
