// package.json 的"契约"测试。
// v0.0.6 的坑: 代码里 registerTerminalProfileProvider('sshRemoteLite.terminal'),
// 但 package.json 没有 contributes.terminal.profiles —— VS Code 因此根本不知道
// 有这个 profile, 终端下拉菜单里没有它, defaultProfile 也就指不过去,
// 于是"新建终端仍然是 Windows PowerShell"。这个用例把两边钉在一起。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROFILE_ID, PROFILE_TITLE } from '../profile';

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
) as Record<string, any>;

test('contributes.terminal.profiles 里有插件注册的那个 profile', () => {
  const profiles = pkg.contributes?.terminal?.profiles ?? [];
  const p = profiles.find((x: any) => x.id === PROFILE_ID);
  assert.ok(p, `package.json 缺少 contributes.terminal.profiles[id=${PROFILE_ID}]`);
  assert.equal(p.title, PROFILE_TITLE, 'profile 标题必须与 terminal.ts 的 PROFILE_TITLE 一致');
});

test('activationEvents 覆盖终端 profile 与启动后激活', () => {
  const evs: string[] = pkg.activationEvents ?? [];
  assert.ok(
    evs.includes(`onTerminalProfile:${PROFILE_ID}`),
    'activationEvents 需要 onTerminalProfile:...,否则第一次用 profile 时插件还没激活'
  );
  assert.ok(evs.includes('onStartupFinished'), '需要 onStartupFinished, 才能在非 ssh:// 工作区里也提供终端');
});

test('一键配置命令已声明', () => {
  const cmds: any[] = pkg.contributes?.commands ?? [];
  assert.ok(
    cmds.some((c) => c.command === 'sshRemoteLite.quickSetup'),
    '缺少 sshRemoteLite.quickSetup 命令'
  );
});

test('defaultHost 配置项存在', () => {
  const props = pkg.contributes?.configuration?.properties ?? {};
  assert.ok(props['sshRemoteLite.defaultHost'], '缺少 sshRemoteLite.defaultHost 设置项');
});
