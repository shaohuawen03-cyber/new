import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SshFileSystemProvider } from './fs';
import { sshTerminalOptions, openSshTerminal } from './terminal';
import {
  getConfigForAuthority,
  getConnection,
  makeAuthority,
  HostConfig,
} from './ssh';
import { execCommand, buildAuthorizeKeyCommand } from './core';

/** 当前工作区如果是 ssh://, 返回其完整主机配置 */
function currentSshConfig(): HostConfig | undefined {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder && wsFolder.uri.scheme === 'ssh') {
    return getConfigForAuthority(wsFolder.uri.authority);
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  // 注册 ssh:// 文件系统(浏览/编辑远端文件, 走 ssh2/SFTP)
  const fsProvider = new SshFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ssh', fsProvider, {
      isCaseSensitive: true,
    })
  );

  // 注册终端 Profile: 终端面板 "+" 旁边的下拉菜单里会出现 "SSH: user@host:port"
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('sshRemoteLite.terminal', {
      provideTerminalProfile(): vscode.TerminalProfile {
        const cfg = currentSshConfig();
        if (!cfg) {
          throw new Error('当前工作区不是 ssh:// 远程工作区,无法创建 SSH 终端');
        }
        return new vscode.TerminalProfile(sshTerminalOptions(cfg));
      },
    })
  );

  // 命令: 连接到主机 —— 弹出输入框, 然后以远程文件夹方式打开工作区
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connect', async () => {
      const input = await vscode.window.showInputBox({
        prompt: '输入 user@host[:port]/路径, 例如 root@10.0.0.5:22/data/app',
        placeHolder: 'root@10.0.0.5:22/root/project',
        ignoreFocusOut: true,
      });
      if (!input) {
        return;
      }
      const uri = vscode.Uri.parse(`ssh://${input}`);
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceNewWindow: true,
      });
    })
  );

  // 命令: 对当前打开的 ssh:// 工作区开一个 SSH 终端
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.openTerminal', async () => {
      let cfg = currentSshConfig();
      if (!cfg) {
        const input = await vscode.window.showInputBox({
          prompt: '输入 user@host[:port]',
          ignoreFocusOut: true,
        });
        if (!input) {
          return;
        }
        cfg = getConfigForAuthority(input);
      }
      await openSshTerminal(cfg);
    })
  );

  // 预配置主机一键开终端(可选)
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connectConfigured', async (cfg: HostConfig) => {
      await openSshTerminal(cfg);
    })
  );

  // 隐藏命令(集成测试用): 按给定配置开一个 SSH 终端并返回 Terminal 对象
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sshRemoteLite._openTestTerminal',
      async (cfg: HostConfig) => openSshTerminal(cfg)
    )
  );

  // 一键部署免密登录: 把本机公钥写入远端 authorized_keys(走插件 SSH 通道, 密码在弹窗输入)
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.uploadPublicKey', async () => {
      const cfg = currentSshConfig();
      const authority = cfg ? makeAuthority(cfg) : undefined;
      if (!authority) {
        vscode.window.showWarningMessage('请先打开 ssh:// 远程工作区再执行此命令');
        return;
      }
      const candidates = [
        path.join(os.homedir(), '.ssh', 'id_ed25519.pub'),
        path.join(os.homedir(), '.ssh', 'id_rsa.pub'),
      ];
      const pubPath = candidates.find((p) => fs.existsSync(p));
      if (!pubPath) {
        vscode.window.showErrorMessage(
          '未找到本机公钥。先在本地终端运行 ssh-keygen -t rsa(一路回车)生成,再执行此命令'
        );
        return;
      }
      const pub = fs.readFileSync(pubPath, 'utf8');
      try {
        const client = await getConnection(authority); // 无预配凭据时弹窗输密码
        const result = await execCommand(client, buildAuthorizeKeyCommand(pub));
        if (result.code === 0) {
          vscode.window.showInformationMessage(
            `免密登录已部署到 ${authority},之后新开的 SSH 终端不再需要密码`
          );
        } else {
          vscode.window.showErrorMessage(
            `远端执行失败(code=${result.code}): ${result.stderr}`
          );
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`部署免密登录失败: ${err?.message ?? err}`);
      }
    })
  );

  // 一键把当前 ssh:// 主机设为默认终端: Agent/反重力 的 shell 命令将跑在远端
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.setDefaultTerminal', async () => {
      const cfg = currentSshConfig();
      if (!cfg) {
        vscode.window.showWarningMessage('请先打开 ssh:// 远程工作区再执行此命令');
        return;
      }
      const name = `SSH: ${makeAuthority(cfg)}`;
      const key =
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
          ? 'osx'
          : 'linux';
      await vscode.workspace
        .getConfiguration('terminal.integrated')
        .update(`defaultProfile.${key}`, name, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `默认终端已设为 ${name},Agent 的命令将发送到远端服务器`
      );
    })
  );

  // 打开 ssh:// 工作区时自动开一个 SSH 终端(设置 sshRemoteLite.autoOpenTerminal 可关)
  const cfg = currentSshConfig();
  const autoOpen = vscode.workspace
    .getConfiguration('sshRemoteLite')
    .get<boolean>('autoOpenTerminal', true);
  if (cfg && autoOpen) {
    void openSshTerminal(cfg).then(() => {
      vscode.window.setStatusBarMessage(
        `SSH 终端已打开: ${makeAuthority(cfg)}`,
        8000
      );
    });
  }
}

export function deactivate(): void {
  // 终端是 IDE 原生进程, 窗口关闭自动结束; SFTP 连接随进程退出断开
}
