import * as vscode from 'vscode';
import { Stats, FileEntryWithStats } from 'ssh2';
import * as sshfs from './ssh';

/**
 * ssh:// 文件系统 Provider。
 *
 * URI 约定:  ssh://user@host:port/absolute/path
 *
 * 说明: 这是"编辑远端文件"能力。语言服务器/扩展仍运行在本地,
 * 不依赖远端安装任何 vscode-server,所以老服务器也能用。
 */
export class SshFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // 轻量实现: 不做远端文件监控
    return new vscode.Disposable(() => {});
  }

  private async sftp(uri: vscode.Uri) {
    return sshfs.getSftp(uri.authority);
  }

  private toFileType(st: Stats): vscode.FileType {
    if (st.isDirectory()) {
      return vscode.FileType.Directory;
    }
    if (st.isSymbolicLink()) {
      return vscode.FileType.SymbolicLink;
    }
    return vscode.FileType.File;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const sftp = await this.sftp(uri);
    const attrs = await sshfs.call<Stats>((cb) => sftp.stat(uri.path, cb));
    return {
      type: this.toFileType(attrs),
      ctime: attrs.atime * 1000,
      mtime: attrs.mtime * 1000,
      size: attrs.size,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const sftp = await this.sftp(uri);
    const entries = await sshfs.call<FileEntryWithStats[]>((cb) => sftp.readdir(uri.path, cb));
    return entries.map((e) => [e.filename, this.toFileType(e.attrs)] as [string, vscode.FileType]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const sftp = await this.sftp(uri);
    await sshfs.call<void>((cb) => sftp.mkdir(uri.path, cb));
    this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const sftp = await this.sftp(uri);
    return sshfs.call<Buffer>((cb) => sftp.readFile(uri.path, cb));
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const sftp = await this.sftp(uri);
    let exists = true;
    try {
      await sshfs.call<Stats>((cb) => sftp.stat(uri.path, cb));
    } catch {
      exists = false;
    }
    if (!exists && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    await sshfs.call<void>((cb) => sftp.writeFile(uri.path, Buffer.from(content), cb));
    this._emitter.fire([
      { type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri },
    ]);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const sftp = await this.sftp(uri);
    const st = await sshfs.call<Stats>((cb) => sftp.stat(uri.path, cb));
    if (st.isDirectory()) {
      if (!options.recursive) {
        throw vscode.FileSystemError.NoPermissions('删除目录需要递归选项');
      }
      const entries = await sshfs.call<FileEntryWithStats[]>((cb) =>
        sftp.readdir(uri.path, cb)
      );
      for (const e of entries) {
        await this.delete(uri.with({ path: `${uri.path}/${e.filename}` }), options);
      }
      await sshfs.call<void>((cb) => sftp.rmdir(uri.path, cb));
    } else {
      await sshfs.call<void>((cb) => sftp.unlink(uri.path, cb));
    }
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const sftp = await this.sftp(oldUri);
    await sshfs.call<void>((cb) => sftp.rename(oldUri.path, newUri.path, cb));
    this._emitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }
}
