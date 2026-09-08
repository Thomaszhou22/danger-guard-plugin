# Danger Guard 插件

[English](./README.md) | [中文](./README_CN.md)

为 OpenClaw agent 提供确定性的破坏性命令执行前拦截。拦截决策由网关里的代码做出——不经过模型——因此不会被遗忘、被长上下文冲淡、也不会被提示注入绕过。

## 为什么有了 skill 还要做 plugin？

[Danger Guard skill](https://github.com/Thomaszhou22/danger-guard-skill) 教 agent 拦截危险命令。它的弱点（真实发生过）：skill 是模型需要"记得遵守"的指令。哪天上下文太长、命令不完整，skill 就没触发。当年 `rm -rf` 漏拦、靠改 skill 描述修复的案例，修的是提示词，不是架构。

这个插件用 `before_tool_call` 钩子把检查搬进网关：模式匹配发生在模型之外，agent 绕不过去。

```
Agent 想执行命令
        ↓
网关执行前钩子（代码，不是提示词）
        ↓
├── 无匹配      → 放行，agent 无感知
├── 二级匹配    → 需要审批（warning）
└── 一级匹配    → 拦截，等待 owner 审批（critical）
                    人类 /approve 放行，否则拒绝
```

## 安装

```bash
openclaw plugins install clawhub:danger-guard-plugin
```

源码安装：

```bash
git clone https://github.com/Thomaszhou22/danger-guard-plugin.git
cd danger-guard-plugin
npm install && npm run build
openclaw plugins install --link . --force
openclaw plugins enable danger-guard
```

验证：`openclaw plugins inspect danger-guard --runtime --json`，然后让 agent 执行 `rm -rf /tmp/danger-guard-test` 看拦截。

## 拦截范围

**一级（critical，拦截待审批）**：rm 递归+强制、mkfs、dd 写磁盘、format、diskpart clean、chmod -R 777 /、shutdown/reboot、fork 炸弹、curl|sh 远程脚本执行。

**二级（warning，需审批）**：git force push / reset --hard / clean -fdx、docker prune 系列、DROP/TRUNCATE/无 WHERE 的 DELETE、npm -g、裸 pip install。

**白名单**：/tmp/、.Trash/、node_modules、%TEMP%。

引号内容在匹配前剥离：commit 信息或 echo 参数里提到 `rm -rf` 不会误报，真实执行仍然拦截。

## 配置（可选）

在 OpenClaw 插件配置里加自定义模式（大小写不敏感正则，非法模式自动忽略）：

```json
{
  "plugins": {
    "entries": {
      "danger-guard": {
        "enabled": true,
        "config": {
          "level1Patterns": ["\\bgcloud\\s+projects\\s+delete"],
          "level2Patterns": ["\\bterraform\\s+destroy"]
        }
      }
    }
  }
}
```

## Skill 与插件互补

| | [Skill](https://github.com/Thomaszhou22/danger-guard-skill) | 本插件 |
|---|---|---|
| 层级 | 提示词（agent 行为） | 网关（架构） |
| 决策者 | 模型按指令行事 | 确定性代码 |
| 会静默失败吗 | 会（上下文过载、漏触发） | 不会 |
| 附加能力 | 密码哈希核验、飞书告警、shell wrapper | 审批门、可配置模式、零提示词成本 |

建议两个都装：插件是硬保证，skill 负责密码核验与告警流程。

## 许可

MIT
