import * as vscode from 'vscode';
import { SFTPFileSystemProvider } from './sftpFsProvider';
import { SSHTerminal } from './sshTerminal';
import { parseAuthority, formatAuthority, normalizeRemotePath, HostConfig } from './core';

export function activate(context: vscode.ExtensionContext) {
  const fsProvider = new SFTPFileSystemProvider();

  // Register ssh:// filesystem provider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ssh', fsProvider, {
      isCaseSensitive: true
    })
  );

  // Command: Connect to Remote Host
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.connect', async () => {
      const config = vscode.workspace.getConfiguration('sshRemoteLite');
      const hosts: HostConfig[] = config.get('hosts', []);

      let selectedHostStr: string | undefined;

      if (hosts.length > 0) {
        const items = [
          ...hosts.map((h) => ({
            label: h.name || `${h.username}@${h.host}:${h.port || 22}`,
            description: h.defaultPath || '/',
            detail: `SSH -> ${h.username}@${h.host}:${h.port || 22}`,
            hostConfig: h
          })),
          {
            label: '$(add) 输入新主机地址...',
            description: '格式: [user@]host[:port][/path]',
            detail: '例如 root@192.168.1.100:22/var/www',
            hostConfig: undefined
          }
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: '选择预配置主机或输入新主机'
        });

        if (!picked) return;

        if (picked.hostConfig) {
          const auth = formatAuthority(picked.hostConfig);
          const targetPath = picked.hostConfig.defaultPath || '/';
          const uri = vscode.Uri.parse(`ssh://${auth}${targetPath}`);
          await vscode.commands.executeCommand('vscode.openFolder', uri, false);
          return;
        }
      }

      const input = await vscode.window.showInputBox({
        prompt: '输入远程 SSH 主机与路径 (格式: [user@]host[:port][/path])',
        placeHolder: 'root@192.168.1.100:22/root/project',
        value: 'root@'
      });

      if (!input) return;

      try {
        let authorityPart = input.trim();
        let pathPart = '/';

        // Check if path is included e.g. root@1.2.3.4:22/var/www
        const firstSlash = authorityPart.indexOf('/');
        if (firstSlash !== -1) {
          pathPart = authorityPart.substring(firstSlash);
          authorityPart = authorityPart.substring(0, firstSlash);
        }

        const auth = parseAuthority(authorityPart);
        const canonicalAuth = formatAuthority(auth);
        const normalizedPath = normalizeRemotePath(pathPart);

        const uri = vscode.Uri.parse(`ssh://${canonicalAuth}${normalizedPath}`);
        await vscode.commands.executeCommand('vscode.openFolder', uri, false);
      } catch (err: any) {
        vscode.window.showErrorMessage(`连接失败: ${err.message || err}`);
      }
    })
  );

  // Command: Open SSH Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.openTerminal', async () => {
      const config = vscode.workspace.getConfiguration('sshRemoteLite');
      const hosts: HostConfig[] = config.get('hosts', []);

      let authority: string | undefined;
      let initialPath: string | undefined;

      if (hosts.length > 0) {
        const items = [
          ...hosts.map((h) => ({
            label: h.name || `${h.username}@${h.host}:${h.port || 22}`,
            description: h.defaultPath || '~',
            hostConfig: h
          })),
          {
            label: '$(terminal) 输入新 SSH 主机...',
            description: '格式: [user@]host[:port]',
            hostConfig: undefined
          }
        ];

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: '选择要打开终端的 SSH 主机'
        });

        if (!picked) return;

        if (picked.hostConfig) {
          authority = formatAuthority(picked.hostConfig);
          initialPath = picked.hostConfig.defaultPath;
        }
      }

      if (!authority) {
        const input = await vscode.window.showInputBox({
          prompt: '输入远程 SSH 主机 (格式: [user@]host[:port])',
          placeHolder: 'root@192.168.1.100:22'
        });
        if (!input) return;
        const auth = parseAuthority(input.trim());
        authority = formatAuthority(auth);
      }

      const pty = new SSHTerminal(authority, initialPath);
      const terminal = vscode.window.createTerminal({
        name: `SSH: ${authority}`,
        pty
      });
      terminal.show();
    })
  );
}

export function deactivate() {}
