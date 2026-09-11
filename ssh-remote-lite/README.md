# SSH Remote Lite

一个「轻量级远程开发」VS Code 插件示例:**不依赖远端安装任何 vscode-server**,因此可以配合
最新版 VS Code 连接那些跑不动新版 vscode-server 的老服务器(如 CentOS 7、glibc < 2.28 的系统)。

## 原理

官方 Remote-SSH 的架构是「本地 UI + 远端 vscode-server(扩展宿主)」,而新版客户端只会下载
与自己 commit 一致的新版 server,新 server 要求 glibc ≥ 2.28,老机器跑不起来。

本插件绕开这套架构,只使用**公开的扩展 API**:

| 能力 | 实现方式 | 效果 |
| --- | --- | --- |
| 浏览/编辑远端文件 | `vscode.workspace.registerFileSystemProvider('ssh', ...)` + SFTP | 资源管理器直接打开 `ssh://user@host:port/路径`,文件即开即存 |
| 交互式终端 | `vscode.window.createTerminal({ pty })` + ssh2 shell | 等价于 xshell/mobaxterm 的终端,支持窗口大小同步 |

## 限制(务必了解)

- 语言扩展(如 Pylance)、调试器、扩展宿主都运行在**本地**,不在远端。
  它提供的是「编辑远端文件 + 在远端跑命令」的体验,不是完整的 Remote-SSH 远程开发。
- 未实现远端文件变更监听(可加 sftp watch / 轮询增强)。
- 认证支持密码和私钥文件(在设置中预配置),未接入 ssh-agent/known_hosts 完整逻辑。

## 构建与安装

```bash
npm install
npm run compile          # 编译到 out/

# 方式一: F5 启动扩展开发宿主调试(需要 .vscode/launch.json, 已提供)
# 方式二: 打包安装
npx @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension ssh-remote-lite-0.0.1.vsix
```

## 使用

1. `Ctrl+Shift+P` → `SSH Remote Lite: 连接到主机...` → 输入
   `root@10.0.0.5:22/root/project`,回车后新窗口以远程目录作为工作区打开。
2. `Ctrl+Shift+P` → `SSH Remote Lite: 新建 SSH 终端` → 打开该主机的交互式终端。

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

## 目录结构

```
src/
  extension.ts   入口: 注册 FileSystemProvider 与命令
  ssh.ts         ssh2 连接池 + 凭据解析
  fs.ts          ssh:// FileSystemProvider 实现
  terminal.ts    自定义 pty 的 SSH 终端
```
