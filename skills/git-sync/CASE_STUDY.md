# 成功案例：新账号 + WSL/Windows 双链路 + 本机 conda ML

**对象**：`shaohuawen03-cyber/git-pull-arena`，分支 `arena/01a0ad15-git-pull-arena`
**用户机器**：`LAPTOP-R77M5D6M`（Windows 11 + WSL2，仓库父目录 `E:\0github\git-sync`）
**结果**：round 38–41（WSL 桥接/探针/ML + Windows 原生 deck）全过；round 46/47
Windows 原生探针 + 肽 ML 全过，验收标准 172/172，真 conda 环境出预测并推回。
**一句话**：以后这个账号 + 这台机器的新会话，先读 §1 三张卡 + §7 清单，5 分钟开工。

## 1. 三张卡（开工前先看这个）

**账号卡**：仓库主＝`shaohuawen03-cyber`；Windows 凭据库里存的是旧号
`mqgg5630-cyber`。旧号已被加为仓库 Collaborator——**两边各用各号，天然共存**：
沙箱/gh 走 shaohuawen03，Windows 值守走存好的 mqgg。push 报
`permission denied` 先查 Collaborators，**不是凭据坏了，别重登录**
（round 41 连跪 10 次，加完协作者第 11 次一次过）。

**Windows 卡**：仓库 `E:\0github\git-sync\git-pull-arena-01a0ad15`；conda base 在
**非标准路径 `E:\spider`**（`Scripts\conda.exe` 在，envs 分布在 `envs/`、
`Library\envs/`、`E:\conda-envs`），共 **22 个环境**，ML 达标 3 个——
**`NTxPred2`**（py3.10.7，numpy1.25/pandas1.5/sklearn1.5，另带 torch CPU）、DIP、
meta-analysis；venv `E:\0github\git-sync\ppt-master\.venv`（py3.11.9，
由 `E:\spider\python.exe -m venv` 生出，是仓库的**兄弟目录**，local_check 永远找得到）；
git 在 `E:\hermes\git`（自带 bash 专供门禁，**不在 PATH 里**）；真 Word/PowerPoint；
CPU 8 核，磁盘余 ~198GB，GPU 按 09-15 台账是 GTX 1650（本季未重测）。
值守＝计划任务 `git-sync-watch-git-pull-arena-01a0ad15`（2 分钟一轮），
状态在 `%LOCALAPPDATA%\git-sync\`。

**WSL 卡**：仓库 `~/projects/git-pull-arena-01a0ad15`；cron 值守（本季后半程已摘，
Windows 执勤中）。**铁律：同一分支只准一侧值守 live**，双 live 会抢答/重复 verdict。
WSL 的 conda 是另一套（13 环境，best=`AMPidentifier`），证据归档在
`machine_probe_linux.json` / `results/peptide_ml_linux/`，和 Windows 版永不混写。

## 2. 双账号共存（round 41）

现象：值守日志 10 次 `permission denied`（`103840–111020`），第 11 次
`b77d505..0a6e9d1` 一次推上。根因：仓库换主（shaohua 新库），Windows 存的还是
旧号 mqgg 凭据。修法：浏览器 → 仓库 Settings → Collaborators → 加回 mqgg。
附带坑：`push.ps1` 把认证拒绝误报成"branch moved, run sync first"——看到这句先看
exit 码是不是 4（认证失败），别真去 sync。

## 3. 值守交接（round 41 前）

同分支 Win+WSL 双值守会抢同一轮。开工先问用户哪侧执勤，另一侧摘掉
（Windows：`.\watch.ps1 -Unregister`；WSL：停 cron）。本季：用户摘了 WSL cron，
Windows 单侧执勤 rounds 41–47，零抢答。

## 4. runner 分流（round 42 起，`code/local_check.ps1` §4）

背景：ps1 原来只会 office-deck（读死 `pptmaster_local.txt`），`loop.json` 切配方它也照跑 deck。
修法（Option-2，小手术）：读 `code\loop.json` 的 recipe，`office-deck` 走原来 inline 路径
（逐字节不动），其他 recipe 走 `local_loop.py local --os windows`，收据判
`loop-ok` + `opened=`（判法与 `local_check.sh` 同构）。
教训：4b/4c 读到的可能是**上轮提交下来的旧收据**（本季就读到过 WSL 的 loop-ok）——
4a 的 exit code 才是真守卫，判轮时先看 4a。

## 5. 找 python 四连败（rounds 42–45，精华）

| 轮 | 现象 | 根因 | 修法 |
|---|---|---|---|
| 42 | PATH 里找不到 python | conda 默认不上 PATH；计划任务 PATH 极简；`python3` 只是 Store 桩（exit 9009），且本机没有 `py` 启动器 | 两阶段发现：**绝对路径先**（venv 兄弟目录 + conda 根），PATH 后，每个候选都 `-c` 实探 |
| 43 | 3 个候选全倒在探针上 | 看起来像"python 全坏了"，信息不足 | 逐候选打印 exists/exit/output，不猜 |
| 44 | venv 和 `E:\spider` 都存在，`import sys` 都 Traceback | 只截了输出**头** 120 字，错误行被砍了；同时确认 `E:\spider` 就是真 conda base | 截**尾** 300 字；加取证块（env 变量、`pyvenv.cfg`、`E:\` 目录、`Lib`/conda.exe 存在性） |
| 45 | 无投毒（PYTHONHOME 等全 unset）、Lib 完好 | **PS 5.1 调 native exe 会吞双引号**：`-c 'print("py-ok")'` 到达 python 时变成 `print(py-ok)` → NameError，每台解释器死法一模一样 | `-c` 里只准**单引号**：`print(''py-ok'')`；另补 `E:/spider`、`E:/` 进探针/包装器的根扫描 |

round 46 一次过（216 秒，venv runner，`envs=22 ml_ready=yes best=NTxPred2`）。
**以后任何从 PowerShell 拼 `-c` 的地方，复制这条铁律：单引号，无例外。**
（python 侧 `subprocess` 传参列表不受影响——只有 PS→native 这条边会吞引号。）

## 6. Windows 配方三件套（round 47）

1. 步骤禁 bash：git-bash 存在但不在 PATH，`{bash}` 占位符在 Windows 不可信——
   Windows 步骤一律 `["{python}", "code/xxx.py"]`（本季：`code/run_peptide_ml.py`，
   `run_peptide_ml.sh` 的纯 stdlib 双胞胎：探针报告 → 新鲜扫描（含 `E:/spider` 双布局）→ PATH，首个能 import numpy/pandas/sklearn 者胜，零安装、零硬编码环境名）。
2. 先 probe 轮，再干活轮：probe 便宜（2–4 分钟），一次验证分流＋发现链＋conda 清单；
   ML 轮直接吃 `machine_probe.json`（Windows 数据，由 verdict 推回覆盖）。
3. 确定性即证据：种子固定的 RF 在 Win/WSL 产出**字节一致**的 `predictions.csv`——
   verdict diff 里没有它**是正常的**（git 无变化），host/解释器/时间戳全在 `metrics.json` 里；
   活目录 `results/peptide_ml/` 给 verdict 覆盖，上个 OS 的版进 `results/peptide_ml_linux/` 归档。

round 47：`NTxPred2` 3.9 秒跑完，acc=0.97（P=1.00 R=0.70），104 秒 verdict passed。

## 7. 新会话 5 分钟清单（这个账号＋这台机器）

1. `git fetch origin` 对远端 tip；读 CONNECTIONS.md 最新两条 + 本案例。
2. 读 `results/status/machine_probe_windows.json`（conda 地图，ML 首选 NTxPred2）——
   环境没变就别重跑 probe 轮。
3. 确认**只有一侧值守 live**（问用户哪侧执勤）。
4. 新配方先跑 probe/冒烟轮验证分流；Windows 步骤必须无 bash；新 `-c` 探针单引号。
5. 新沙箱 push 用 gh（shaohuawen03）；Windows 侧 push 失败先看 Collaborators 和 exit 4。
6. 收尾：`loop.json` 切回 `office-deck`（＋payload 镜像），判轮只看 request→verdict→accept 链。
7. 沙箱 `.git` 被重置（`git log` 只剩基线）→ 先 `agent-recover.sh`，再 `cmp` 对工作区，
   不要急着重写文件。

## 8. 沙箱侧三坑（本季亲测）

* **`.git` 静默重置**：表现为 shallow 单分支 clone＋工作区快照覆盖。修：补 refspec
  → `fetch --unshallow` → `cmp` 确认快照＝远端 → `reset --hard origin/<branch>`
  （untracked 文件不受影响；未提交的改动先留 patch）。`agent-recover.sh` 一键版。
* **handsfree 退出码被吃了**：`cmd | tail; echo $?` 拿到的是 tail 的 0。
  等 verdict 必须 `> file 2>&1; echo $?` 或 `${PIPESTATUS[0]}`，再加 verdict 提交＋handshake 双确认。
* **`require_contains` 的值必须是字符串**：门禁按 `str(needle) not in body` 判，
  传 list 会变成 Python repr（`['a', 'b']`）永远匹配不上——一个文件只 pin 一个子串，
  要 pin 多个就选横跨两者的那一段原文。
