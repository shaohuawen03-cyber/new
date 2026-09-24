// 终端 profile 的"单一真相": package.json 的 contributes.terminal.profiles、
// 代码里的 registerTerminalProfileProvider、以及 setDefaultTerminal 写进
// terminal.integrated.defaultProfile.* 的名字, 三处必须完全一致。
// (不 import vscode, 这样 node 单测也能引用它做契约校验。)
export const PROFILE_ID = 'sshRemoteLite.terminal';
export const PROFILE_TITLE = 'SSH Remote Lite';
