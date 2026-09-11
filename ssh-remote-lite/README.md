# SSH Remote Lite

一个「轻量级远程开发」VS Code 插件:**不依赖远端安装任何 vscode-server**,因此可以配合
最新版 VS Code(以及 Google Antigravity 等 VS Code 分支)连接那些跑不动新版
vscode-server 的老服务器(如 CentOS 7、glibc < 2.28 的系统)。

老服务器即便只有终端访问也没问题 —— 本插件的全部能力都只走 SSH 通道。

## 原理

官方 Remote-SSH 的架构是「本地 UI + 远端 vscode-server(扩展宿主)」,而新版客户端只会下载
与自己 commit 一致的新版 server,新 server 要求 glibc ≥ 2.28,老机器跑不起来。

本插件绕开这套架构,只使用**稳定的公开扩展 API**(无任何 proposed API):

| 能力 | 实现方式 | 效果 |
| --- | --- | --- |
| 浏览/编辑远端文件 | `vscode.workspace.registerFileSystemProvider('ssh', ...)` + SFTP | 资源管理器直接打开 `ssh://user@host:port/路径`,文件即开即存 |
| 交互式终端 | IDE 原生进程终端,直接运行系统 `ssh`(与 PowerShell 终端同机制) | 等价于 xshell/mobaxterm 的终端;密码在终端里输入,或走预配置私钥 |

## 兼容性

- `engines.vscode`: `^1.75.0` —— 最新版 VS Code、1.85.2、Google Antigravity、Cursor、
  VSCodium 等 VS Code 系产品均可安装。
- **反重力 (Antigravity) 安装方式**: `Extensions` 面板右上角 `...` →
  `Install from VSIX...` → 选择 `ssh-remote-lite-x.y.z.vsix`。

## 构建、测试与安装

```bash
npm install
npm run compile          # 编译到 out/
npm test                 # 自动化测试(见下)

# 方式一: F5 启动扩展开发宿主调试
# 方式二: 打包安装
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension ssh-remote-lite-0.0.1.vsix
```

### 测试说明

`npm test` 会用 `node --test` 运行 `src/test/` 下的用例,包含一个**内嵌的真实
SSH 服务器**(ssh2 Server + 内存文件系统 SFTP + echo shell),不需要真实远程主机:

- `core.test.ts`: authority 解析/拼接、`~` 展开等纯逻辑用例;
- `e2e.test.ts`: 真实 SSH 握手 + 密码认证(含错误密码拒绝)、
  SFTP 全流程(mkdir/写/读/列目录/统计/改名/删除)、读取不存在文件报错、
  shell 欢迎语与输入回显。

## 使用

1. `Ctrl+Shift+P` → `SSH Remote Lite: 连接到主机...` → 输入
   `root@10.0.0.5:22/root/project`,回车后新窗口以远程目录作为工作区打开。
2. **打开 ssh:// 工作区会自动开一个 SSH 终端**(默认开启,可用设置
   `sshRemoteLite.autoOpenTerminal` 关闭)。终端由系统 `ssh` 提供,
   首次连接输入 `yes` 接受主机密钥,密码直接在终端里输入;
   也可在 `sshRemoteLite.hosts` 预配 `privateKeyPath` 实现免密。
3. 终端面板 `+` 旁边的 `∨` 下拉里会出现 **`SSH: user@host:port`** 配置,
   也可以 `Terminal: Select Default Profile` 把它设为默认终端。
   注意:直接点 `+` 新建的仍是**本地**终端,这是 IDE 本身行为,不是插件 bug。
4. 也可以用命令 `SSH Remote Lite: 新建 SSH 终端` 手动开终端
   (老服务器只有终端时,这就是你的主战场)。
5. 系统 ssh 位置不对时,用设置 `sshRemoteLite.sshPath` 指定可执行文件路径。

## 让 Agent(反重力 / Copilot 等)在远端分析和改代码

- **读/分析/保存代码**: Agent 通过 `ssh://` 文件系统读写远端文件,天然可用。
  注意:要让文件系统连接不弹密码框,必须在 `sshRemoteLite.hosts` 里预配
  `password` 或 `privateKeyPath`(Agent 不会替你输密码)。
- **让 Agent 的 shell 命令跑在远端**: 在远程工作区执行命令
  `SSH Remote Lite: 把 SSH 设为默认终端 (Agent 命令跑在远端)`,
  之后 Agent 开的终端默认就是 ssh 会话,`grep`/构建/跑脚本都在老服务器上执行。
- **建议配置免密登录**,否则 Agent 每次开终端都要等密码:
  本地 `ssh-keygen` 后把公钥加入服务器 `~/.ssh/authorized_keys`
  (或直接在 `sshRemoteLite.hosts` 写 `privateKeyPath`)。
- 局限: 语言服务器级智能(跳转定义/重构)仍在本地;搜索大目录依赖
  FileSystemProvider,速度一般,可让 Agent 直接在远端终端里用 `grep -rn`。

### 预配置凭据(可选)

在 `settings.json`:

```json
"sshRemoteLite.hosts": [
  {
    "name": "old-box",
    "host": "10.0.0.5",
    "port": 22,
    "username": "root",
    "password": "xxx"
  },
  {
    "host": "10.0.0.6",
    "username": "dev",
    "privateKeyPath": "~/.ssh/id_rsa",
    "passphrase": "可选"
  }
]
```

## 限制(务必了解)

- 语言扩展(如 Pylance)、调试器、扩展宿主都运行在**本地**,不在远端。
  它提供的是「编辑远端文件 + 在远端跑命令」的体验,不是完整的 Remote-SSH 远程开发。
- 未实现远端文件变更监听(可加轮询增强)。
- 认证支持密码和私钥文件,未接入 ssh-agent/known_hosts 完整逻辑。

## 目录结构

```
src/
  core.ts        纯 Node 层(可独立测试): 连接配置/解析/ssh2 封装
  extension.ts   入口: 注册 FileSystemProvider 与命令
  ssh.ts         vscode 胶水层: 连接池 + 凭据解析 + 密码弹窗
  fs.ts          ssh:// FileSystemProvider 实现
  terminal.ts    自定义 pty 的 SSH 终端
  test/          自动化测试(内嵌 SSH 服务器, 无需真实主机)
```
