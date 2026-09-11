import * as vscode from 'vscode';
import { Client, ClientChannel } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseAuthority, HostConfig } from './core';

export class SSHTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite: vscode.Event<string> = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

  private client: Client | null = null;
  private channel: ClientChannel | null = null;
  private currentCols = 80;
  private currentRows = 24;

  constructor(
    private readonly authority: string,
    private readonly initialPath?: string,
    private readonly preconfiguredPassword?: string
  ) {}

  async open(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    if (initialDimensions) {
      this.currentCols = initialDimensions.columns;
      this.currentRows = initialDimensions.rows;
    }

    this.writeEmitter.fire(`Connecting to ${this.authority} via SSH...\r\n`);

    try {
      const auth = parseAuthority(this.authority);
      const config = vscode.workspace.getConfiguration('sshRemoteLite');
      const hosts: HostConfig[] = config.get('hosts', []);
      const matchingHost = hosts.find(
        (h) => (h.name && h.name === this.authority) || (h.host === auth.host && (!h.port || h.port === auth.port))
      );

      let password = matchingHost?.password || this.preconfiguredPassword;
      let privateKey: Buffer | undefined;

      if (matchingHost?.privateKeyPath) {
        let keyPath = matchingHost.privateKeyPath;
        if (keyPath.startsWith('~/') || keyPath === '~') {
          keyPath = path.join(os.homedir(), keyPath.substring(keyPath === '~' ? 1 : 2));
        }
        if (fs.existsSync(keyPath)) {
          privateKey = fs.readFileSync(keyPath);
        }
      }

      if (!password && !privateKey) {
        password = await vscode.window.showInputBox({
          prompt: `请输入 ${auth.username}@${auth.host}:${auth.port} 的 SSH 密码`,
          password: true,
          ignoreFocusOut: true
        });
        if (!password) {
          this.writeEmitter.fire('Connection cancelled: No password provided.\r\n');
          this.closeEmitter.fire();
          return;
        }
      }

      this.client = new Client();

      this.client
        .on('ready', () => {
          this.writeEmitter.fire(`SSH connection established.\r\n\r\n`);

          this.client!.shell(
            {
              term: process.env.TERM || 'xterm-256color',
              cols: this.currentCols,
              rows: this.currentRows
            },
            (err, stream) => {
              if (err) {
                this.writeEmitter.fire(`Shell error: ${err.message}\r\n`);
                this.closeEmitter.fire();
                return;
              }

              this.channel = stream;

              if (this.initialPath && this.initialPath !== '/' && this.initialPath !== '~') {
                this.channel.write(`cd "${this.initialPath}"\r\n`);
              }

              this.channel.on('data', (data: Buffer) => {
                this.writeEmitter.fire(data.toString('utf8'));
              });

              this.channel.on('close', () => {
                this.writeEmitter.fire('\r\nConnection closed by remote host.\r\n');
                this.closeEmitter.fire();
              });
            }
          );
        })
        .on('error', (err) => {
          this.writeEmitter.fire(`\r\nSSH Connection Error: ${err.message}\r\n`);
          this.closeEmitter.fire();
        })
        .on('close', () => {
          this.closeEmitter.fire();
        })
        .connect({
          host: auth.host,
          port: auth.port,
          username: auth.username,
          password,
          privateKey,
          readyTimeout: 20000,
          keepaliveInterval: 10000
        });
    } catch (err: any) {
      this.writeEmitter.fire(`Error: ${err.message || err}\r\n`);
      this.closeEmitter.fire();
    }
  }

  close(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {}
      this.channel = null;
    }
    if (this.client) {
      try {
        this.client.end();
      } catch {}
      this.client = null;
    }
  }

  handleInput(data: string): void {
    if (this.channel) {
      this.channel.write(data);
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.currentCols = dimensions.columns;
    this.currentRows = dimensions.rows;
    if (this.channel && (this.channel as any).setWindow) {
      (this.channel as any).setWindow(dimensions.rows, dimensions.columns, 0, 0);
    }
  }
}
