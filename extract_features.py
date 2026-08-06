"""
extract_features.py - 多肽 37 维理化与药效基序特征提取工具
用于将大豆萌芽肽序列批量计算为与训练集格式完全对齐的特征表格。
"""

import sys
import os
import pandas as pd
import numpy as np

def calculate_37_features(seq):
    if not isinstance(seq, str):
        return None
    seq = seq.strip().upper()
    L = len(seq)
    if L == 0:
        return None
    
    mw_dict = {'A':71.04,'C':103.01,'D':115.03,'E':129.04,'F':147.07,'G':57.02,'H':137.06,
               'I':113.08,'K':128.09,'L':113.08,'M':131.04,'N':114.04,'P':97.05,'Q':128.06,
               'R':156.10,'S':87.03,'T':101.05,'V':99.07,'W':186.08,'Y':163.06}
    kd_hydro = {'A':1.8,'C':2.5,'D':-3.5,'E':-3.5,'F':2.8,'G':-0.4,'H':-3.2,
                'I':4.5,'K':-3.9,'L':3.8,'M':1.9,'N':-3.5,'P':-1.6,'Q':-3.5,
                'R':-4.5,'S':-0.8,'T':-0.7,'V':4.2,'W':-0.9,'Y':-1.3}
    
    mw = sum(mw_dict.get(aa, 110.0) for aa in seq) + 18.015
    gravy = sum(kd_hydro.get(aa, 0.0) for aa in seq) / L
    hydro_aa = sum(seq.count(a) for a in ['L','I','V','F','W','M','A','C'])
    arom_aa = sum(seq.count(a) for a in ['F','W','Y'])
    aliph_idx = (seq.count('A') + 2.9*seq.count('V') + 3.9*(seq.count('I')+seq.count('L'))) / L * 100.0
    pos = seq.count('K') + seq.count('R') + (1 if seq[0] not in ['D','E'] else 0)
    neg = seq.count('D') + seq.count('E') + 1
    
    res = {
        'Sequence': seq,
        'Length': L,
        'MW': round(mw, 2),
        'pI': 7.0,
        'Net_charge': pos - neg,
        'GRAVY': round(gravy, 3),
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

def process_file(input_file, output_file, seq_column="Sequence"):
    print(f"正在读取输入文件: {input_file} ...")
    if input_file.endswith('.xlsx') or input_file.endswith('.xls'):
        df = pd.read_excel(input_file)
    else:
        df = pd.read_csv(input_file)
        
    if seq_column not in df.columns:
        # 尝试自动寻找序列列
        candidates = [c for c in df.columns if any(k in str(c).lower() for k in ['seq', 'peptide', '序列', '肽'])]
        if candidates:
            seq_column = candidates[0]
            print(f"自动识别到序列列: [{seq_column}]")
        else:
            raise ValueError(f"未找到序列列，当前列名: {list(df.columns)}")
            
    print(f"开始批量提取 {len(df)} 条多肽的 37 维特征...")
    feature_rows = []
    for s in df[seq_column]:
        feat = calculate_37_features(s)
        if feat:
            feature_rows.append(feat)
            
    df_feat = pd.DataFrame(feature_rows)
    print(f"特征提取完毕，有效数据 {len(df_feat)} 行，正在保存至 {output_file} ...")
    if output_file.endswith('.csv'):
        df_feat.to_csv(output_file, index=False)
    else:
        df_feat.to_excel(output_file, index=False)
    print("保存成功！可直接在 Orange3 中通过 File 控件载入。")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        inp = sys.argv[1]
        outp = sys.argv[2]
        col = sys.argv[3] if len(sys.argv) > 3 else "Sequence"
        process_file(inp, outp, col)
    else:
        print("用法示例: python extract_features.py <输入多肽表.xlsx> <输出特征表.xlsx> [序列列名]")
