# Danger Guard Plugin

Deterministic pre-exec interception of destructive shell commands for OpenClaw agents. The block decision is made by code in the Gateway — not by the model — so it cannot be forgotten, distracted, or prompt-injected away.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-plugin-blue)](https://openclaw.ai)
[![ClawHub](https://img.shields.io/badge/ClawHub-danger--guard-red)](https://clawhub.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)

[English](./README.md) | [中文](./README_CN.md)

---

## Why a plugin, when the skill exists?

The [Danger Guard skill](https://github.com/Thomaszhou22/danger-guard-skill) teaches the agent to intercept dangerous commands. Its weakness — verified in real use — is that a skill is instructions the model must remember to follow. One day the context is long, the command is incomplete, and the skill never fires. The failure that inspired Skill Compass was exactly this: `rm -rf` went through, and the fix was editing the skill description. That fixes a prompt, not the architecture.

This plugin moves the check into the Gateway with the `before_tool_call` hook:

```
Agent decides to run a command
        ↓
Gateway pre-exec hook (code, not prompts)
        ↓
├── no match        → execute, agent never notices
├── Level 2 match   → approval required (warning)
└── Level 1 match   → blocked pending owner approval (critical)
                        /approve from the human, or deny
```

Pattern matching happens outside the model. The agent cannot bypass it, forget it, or be tricked around it.

## Install

```bash
openclaw plugins install clawhub:danger-guard-plugin
```

Or from source:

```bash
git clone https://github.com/Thomaszhou22/danger-guard-plugin.git
cd danger-guard-plugin
npm install && npm run build
openclaw plugins install --link . --force
openclaw plugins enable danger-guard
```

Verify:

```bash
openclaw plugins inspect danger-guard --runtime --json
```

Then ask your agent to run `rm -rf /tmp/danger-guard-test` and approve or deny the gate.

## What it catches

**Level 1 — critical (blocked pending owner approval):**
- `rm` with recursive+force flags, recursive `rm` aimed at `/` or `~`
- `mkfs`, `dd of=/dev/sd*`, `format C:`, `diskpart clean`
- `chmod -R 777 /`, `chown -R` on root
- `shutdown` / `reboot` / `halt` / `poweroff`, fork bombs
- `curl ... | sh`, `wget ... | bash`, `iwr ... | iex` (remote script execution)

**Level 2 — risky (approval required, warning):**
- `git push --force / --mirror`, `git reset --hard`, `git clean -fdx`
- `docker system/volume/image/container prune`, `docker rm $(...)`
- `DROP TABLE / DATABASE`, `TRUNCATE`, `DELETE FROM` without `WHERE`
- `npm install -g`, bare `pip install`

**Whitelisted (no interception):** `/tmp/`, `.Trash/`, `node_modules` rebuilds, `%TEMP%`.

Quoted strings are stripped before matching, so a commit message or `echo` argument that merely mentions `rm -rf` does not trigger a false positive — while real executions still do.

## Configuration

Optional, in your OpenClaw plugin config:

```json
{
  "plugins": {
    "entries": {
      "danger-guard": {
        "enabled": true,
        "config": {
          "level1Patterns": ["\\bgcloud\\s+projects\\s+delete"],
          "level2Patterns": ["\\bterraform\\s+destroy"],
          "whitelistPatterns": ["\\/sandbox\\/"],
          "severityLevel2": "warning"
        }
      }
    }
  }
}
```

All patterns are case-insensitive regexes. Invalid patterns are ignored (never crash the hook).

## Skill + Plugin, together

The two are complementary and safe to run together:

| | [Skill](https://github.com/Thomaszhou22/danger-guard-skill) | This plugin |
|---|---|---|
| Layer | Prompt (agent behavior) | Gateway (architecture) |
| Decision maker | The model, following instructions | Deterministic code |
| Can fail silently? | Yes (context overload, missed trigger) | No |
| Extra features | Password hash verification, Feishu alerts, shell wrapper, cross-tool configs | Approval gates, config-driven patterns, zero prompt cost |

Recommended: install both. The plugin is the hard guarantee; the skill handles password-verified execution and alerting flows.

## How it was validated

The pattern engine is tested against a battery that includes true positives (`rm -rf /`, `rm -fr ~/docs`, `curl | sh`, `dd of=/dev/sda`, `git push --force`, `docker system prune -af`, `DROP TABLE users;`) and true negatives (`ls -la`, `rm file.txt`, and the false-positive traps: `git commit -m "rm -rf mention"`, `echo "danger: rm -rf /"`). Quoted-content stripping keeps the mention-only cases green while real executions stay blocked.

## License

MIT
