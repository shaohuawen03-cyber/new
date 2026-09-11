# SSH Remote Lite

> 专为 Google Antigravity、VS Code、Cursor 与老旧服务器设计的超轻量级 SSH 远程开发扩展。
> 远端**零安装任何 node / vscode-server 依赖**，彻底告别 glibc 版本不兼容、MUSL 限制与网络下载卡死问题。

---

## 🌟 核心特性

1. **远端零依赖 (Zero Server-side Dependencies)**
   - 传统 `remote-ssh` 需要在远程下载并运行 `vscode-server` (要求高版本 glibc 与 nodejs 环境)。
   - `SSH Remote Lite` 纯走原生 **SSH2 + SFTP** 协议，远端只要有 `sshd` 终端即可工作！
2. **SFTP 虚拟文件系统 (Native FileSystemProvider)**
   - 全功能目录树遍历、文件多级创建/重命名/删除、即时保存与多标签页协同。
3. **原生交互式 SSH 终端 (Pseudoterminal)**
   - 完美适配 ANSI 彩色高亮、自动窗口尺寸同步 (`cols`/`rows`)、输入回显，体验等同本地终端/XShell。
4. **内置 In-Process SSH+SFTP 测试桩 (100% 离线自测)**
   - 自带基于内存文件系统与真 SSH2 协议的内嵌测试服务器，无需实体服务器即可端到端验证 11 项全链路特性。
5. **Antigravity 全兼容**
   - 严格基于 VS Code `^1.75.0` 稳定公开 API 编写，无任何实验性/内部未公开 API，完美兼容 Antigravity IDE、VS Code、Cursor、VSCodium。

---

## 🚀 快速上手

### 1. 安装与打包

通过 `vsce` 打包成 `.vsix` 文件：
```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository --skip-license
```

在 Antigravity / VS Code 中：
- 打开扩展面板 (`Ctrl+Shift+X`)
- 点击右上角菜单 `...` -> **从 VSIX 安装... (Install from VSIX...)**
- 选择打包生成的 `ssh-remote-lite-0.0.1.vsix` 即可完成安装。

---

### 2. 使用方法

#### A. 打开远程工作区
1. 按 `Ctrl+Shift+P` 打开命令面板；
2. 输入并执行：`SSH Remote Lite: 连接到主机...`；
3. 输入主机连接信息：
   - 格式：`[user@]host[:port][/path]`
   - 示例：`root@192.168.1.100:22/root/my-project`
4. 根据提示输入 SSH 登录密码，即可直接在新窗口中浏览与编辑远程代码。

#### B. 打开远程 SSH 终端
1. 按 `Ctrl+Shift+P` 打开命令面板；
2. 输入并执行：`SSH Remote Lite: 新建 SSH 终端`；
3. 输入主机地址（或选择预设主机），即刻在下方面板拉起交互式 SSH 终端。

---

## ⚙️ 预配置主机 (`settings.json`)

你可以在 VS Code / Antigravity 的 `settings.json` 中预配常用服务器：

```json
{
  "sshRemoteLite.hosts": [
    {
      "name": "生产老服务器",
      "host": "192.168.1.50",
      "port": 22,
      "username": "root",
      "privateKeyPath": "~/.ssh/id_rsa",
      "defaultPath": "/data/app"
    },
    {
      "name": "测试服务器",
      "host": "10.0.0.8",
      "port": 2222,
      "username": "ubuntu",
      "defaultPath": "/home/ubuntu/project"
    }
  ]
}
```

---

## 🧪 自动化测试验证

本项目配有内嵌的在进程 SSH+SFTP 服务器测试套件，端到端验证 11 个测试用例：

```bash
npm test
```

### 测试矩阵

| 序号 | 测试用例 | 说明 | 结果 |
| :--- | :--- | :--- | :---: |
| 1-5 | `parseAuthority` | 端口、默认用户、IPv6、URL-encoded 组合测试 | ✅ PASS |
| 6 | `formatAuthority` | 规范化序列化格式 | ✅ PASS |
| 7 | `normalizeRemotePath` | `~` 家目录展开与 UNIX 路径相对解析 | ✅ PASS |
| 8 | SSH 握手与认证 | 正确密码认证通过，错误密码安全拒绝 | ✅ PASS |
| 9 | SFTP 全生命周期 | `mkdir` -> 中文/UTF-8 写入 -> `read` -> `readdir` -> `stat` -> `rename` -> `unlink` -> `rmdir` | ✅ PASS |
| 10 | 异常处理 | 读取不存在路径正确抛出 `NO_SUCH_FILE` 异常 | ✅ PASS |
| 11 | Shell 终端回显 | 欢迎横幅接收、终端命令回显与数据流互通 | ✅ PASS |
