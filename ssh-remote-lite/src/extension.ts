import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SshFileSystemProvider } from './fs';
import { sshTerminalOptions, openSshTerminal } from './terminal';
import {
  PROFILE_ID,
  staticProfileEntry,
  staticProfileName,
  mergeProfileSetting,
  sanitizeKeyPath,
} from './profile';
import { findSshExecutable } from './terminal';
import { ensurePasswordlessLogin } from './autologin';
import {
  getConfigForAuthority,
  getConnection,
  makeAuthority,
  HostConfig,
} from './ssh';
import { execCommand, buildAuthorizeKeyCommand } from './core';

/** 终端 profile / 命令用的主机: ssh:// 工作区 > sshRemoteLite.defaultHost > hosts[0] */
export function resolveTargetConfig(): HostConfig | undefined {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder && wsFolder.uri.scheme === 'ssh') {
    return getConfigForAuthority(wsFolder.uri.authority);
  }
  const conf = vscode.workspace.getConfiguration('sshRemoteLite');
  const def = conf.get<string>('defaultHost', '');
  if (def) {
    return getConfigForAuthority(def);
  }
  const hosts = conf.get<HostConfig[]>('hosts', []) || [];
  if (hosts.length > 0) {
    const h = hosts[0];
    return getConfigForAuthority(`${h.username ?? 'root'}@${h.host}:${h.port ?? 22}`);
  }
  return undefined;
}

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
    vscode.window.registerTerminalProfileProvider(PROFILE_ID, {
      async provideTerminalProfile(): Promise<vscode.TerminalProfile> {
        const cfg = resolveTargetConfig();
        if (!cfg) {
          throw new Error(
            '还没有配置远程主机: 运行命令 "SSH Remote Lite: 一键配置远程主机" 或设置 sshRemoteLite.defaultHost'
          );
        }
        // 有密码没私钥时先自动部署免密, 这样 profile 终端一进去就是远端 shell
        const res = await ensurePasswordlessLogin(cfg);
        return new vscode.TerminalProfile(sshTerminalOptions(res.cfg));
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
      const res = await ensurePasswordlessLogin(cfg);
      await openSshTerminal(res.cfg);
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

  // 一键配置远程主机: 存主机+密码 -> 自动部署免密 -> 设为默认终端 -> 开终端
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite.quickSetup', async () => {
      const conf = vscode.workspace.getConfiguration('sshRemoteLite');
      const hosts = (conf.get<HostConfig[]>('hosts', []) || []).slice();
      const prev = hosts[0];
      const target = await vscode.window.showInputBox({
        prompt: '远程主机 user@host[:port]',
        value: prev ? `${prev.username ?? 'root'}@${prev.host}:${prev.port ?? 22}` : '',
        placeHolder: '25wenshaohua@10.10.5.210:22',
        ignoreFocusOut: true,
      });
      if (!target) {
        return;
      }
      const parsed = getConfigForAuthority(target);
      const password = await vscode.window.showInputBox({
        prompt: `输入 ${parsed.username}@${parsed.host} 的密码(只需这一次, 之后自动免密)`,
        password: true,
        value: prev && prev.host === parsed.host ? prev.password ?? '' : '',
        ignoreFocusOut: true,
      });
      if (password === undefined) {
        return;
      }
      const entry: HostConfig = {
        host: parsed.host,
        port: parsed.port ?? 22,
        username: parsed.username ?? 'root',
        password: password || undefined,
      };
      const rest = hosts.filter(
        (h) => !(h.host === entry.host && (h.port ?? 22) === (entry.port ?? 22))
      );
      await conf.update('hosts', [entry, ...rest], vscode.ConfigurationTarget.Global);
      await conf.update('defaultHost', makeAuthority(entry), vscode.ConfigurationTarget.Global);

      const res = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在配置免密登录 ...' },
        () => ensurePasswordlessLogin(entry)
      );
      if (res.deployed) {
        // 公钥已在远端: 把私钥路径也存下来, 以后连密码都不需要读
        const saved: HostConfig = { ...entry, privateKeyPath: res.keyPath };
        await conf.update('hosts', [saved, ...rest], vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
          `免密登录已配置好: ${makeAuthority(entry)} (公钥已写入远端 authorized_keys)`
        );
      } else {
        vscode.window.showWarningMessage(
          `免密部署未成功(${res.error ?? '未知原因'}) - 终端会自动替你输入密码`
        );
      }
      await vscode.commands.executeCommand('sshRemoteLite.setDefaultTerminal');
      await openSshTerminal(res.cfg);
    })
  );

  // 隐藏命令(集成测试用): 只做"密码->免密"这一步, 返回结果
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sshRemoteLite._autoLogin',
      async (cfg: HostConfig, sshDir?: string) => ensurePasswordlessLogin(cfg, sshDir)
    )
  );

  // 隐藏命令(集成测试用): 终端 profile 真正会用的命令行
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite._profileOptions', () => {
      const cfg = resolveTargetConfig();
      return cfg ? sshTerminalOptions(cfg) : undefined;
    })
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
      const base = resolveTargetConfig();
      if (!base) {
        vscode.window.showWarningMessage(
          '还没有远程主机: 先运行 "SSH Remote Lite: 一键配置远程主机"'
        );
        return;
      }
      // 有密码没密钥时先把免密配好, 这样写进设置的命令行是 ssh -i <key>,
      // 默认终端一开就直接进远端, 不会停在密码提示上
      const res = await ensurePasswordlessLogin(base);
      const cfg = res.cfg;
      const key =
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
          ? 'osx'
          : 'linux';

      // 关键: 写一条"普通" profile(path + args), 不依赖插件是否被激活。
      // 只靠 contributes.terminal.profiles 时, 插件没激活的那一刻 IDE 会报
      //   No terminal profile provider registered for id "sshRemoteLite.terminal"
      // 然后退回本地 shell(用户实测 2026-09-24)。
      const safeCfg = {
        ...cfg,
        privateKeyPath: sanitizeKeyPath(cfg.privateKeyPath, (p) => fs.existsSync(p)),
      };
      const name = staticProfileName(safeCfg);
      const entry = staticProfileEntry(safeCfg, findSshExecutable());
      const termConf = vscode.workspace.getConfiguration('terminal.integrated');
      // inspect().globalValue = 用户自己的那份, 不含 IDE 内置 profile
      const own = termConf.inspect<Record<string, unknown>>(`profiles.${key}`)?.globalValue;
      const profiles = mergeProfileSetting(own, name, entry);
      await termConf.update(`profiles.${key}`, profiles, vscode.ConfigurationTarget.Global);
      await termConf.update(`defaultProfile.${key}`, name, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `默认终端已设为 "${name}"${res.deployed ? ' (已配好免密)' : ''} - 新建终端/Agent 命令都会跑在远端`
      );
    })
  );

  // 隐藏命令(集成测试用): 返回本次写进设置的 profile 名字
  context.subscriptions.push(
    vscode.commands.registerCommand('sshRemoteLite._staticProfileName', () => {
      const cfg = resolveTargetConfig();
      return cfg ? staticProfileName(cfg) : undefined;
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
