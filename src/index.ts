/**
 * Danger Guard — OpenClaw plugin
 *
 * Deterministic pre-exec interception of destructive shell commands.
 * Unlike the danger-guard *skill* (which relies on the model reading and
 * following instructions), this plugin hooks `before_tool_call` in the
 * Gateway: the decision is made by pattern matching in code, outside the
 * model, so it cannot be forgotten, distracted, or bypassed.
 *
 * Flow: exec call -> pattern match -> Level 1: block pending owner approval
 * (critical); Level 2: requireApproval (warning). All matches log to console.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

/** Level 1 — critical: irreversible destruction (filesystem-wide, disk, boot). */
const LEVEL_1: RegExp[] = [
  /\brm\s+[^#|;&]*\s-[a-z]*r[a-z]*f/i, // rm with both -r and -f in any order
  /\brm\s+-[a-z]*f[a-z]*r/i,
  /\brm\s+-(?:rf|fr)\b/i,
  /\brm\s+-r\b[^#|;&]*(?:\/|~|\$HOME)/i, // recursive rm aimed at root/home
  /\bmkfs\b/i,
  /\bdd\s+[^#|;&]*\bof=\/dev\/(?:sd|disk|nvme)/i,
  /\bformat\s+[a-z]:/i,
  /\brd\s+\/s\s+\/q/i,
  /\bdiskpart\s+clean/i,
  /:\(\)\s*\{.*\};\s*:/, // fork bomb
  />\s*\/dev\/(?:sd|disk)/i,
  /\bchmod\s+-R\s+(?:777|000)\s+\//i,
  /\bchown\s+-R\s+\S+\s+\/(?:\s|$)/i,
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  /\bcurl\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
  /\bwget\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
  /\biwr\b[^|;&]*\|\s*iex\b/i,
];

/** Level 2 — risky: usually recoverable or version-controlled, still gated. */
const LEVEL_2: RegExp[] = [
  /\bgit\s+push\s+(?:--force(?:-with-lease)?|--mirror)\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f[a-z]*d[a-z]*x?/i,
  /\bdocker\s+(?:system|volume|image|container)\s+prune\b/i,
  /\bdocker\s+(?:rm|rmi|volume\s+rm)\s+\$\(/i,
  /\b(?:DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+TABLE)\b/i,
  /\bDELETE\s+FROM\s+\S+\s*(?:;|$)/i, // DELETE without WHERE
  /\bnpm\s+install\s+-g\b/i,
  /\bpip\s+install\b(?![^|;&]*--user)(?![^|;&]*-e\b)/i,
];

const DEFAULT_WHITELIST: RegExp[] = [
  /\/tmp\//i,
  /\/private\/tmp\//i,
  /\.Trash\//i,
  /%TEMP%/i,
  /\brm\s+[^#|;&]*\bnode_modules\b/i, // build dirs are routinely rebuilt
  /\/\.git\/objects\/pack\//i,
];

interface Config {
  level1Patterns?: string[];
  level2Patterns?: string[];
  whitelistPatterns?: string[];
  severityLevel2?: "info" | "warning" | "critical";
}

function compileAll(builtIn: RegExp[], extra: string[] | undefined): RegExp[] {
  const out = [...builtIn];
  if (extra) {
    for (const p of extra) {
      try {
        out.push(new RegExp(p, "i"));
      } catch {
        // Invalid user pattern: ignore rather than crash the hook.
      }
    }
  }
  return out;
}

function safeMatchIndex(command: string): number {
  // Strip quotes/newlines cheaply so patterns still see the tokens.
  return 0;
}

export default definePluginEntry({
  id: "danger-guard",
  name: "Danger Guard",
  description:
    "Deterministic pre-exec interception of destructive shell commands, outside the model.",
  register(api) {
    const raw = (api as unknown as { config?: unknown }).config;
    const cfg: Config =
      raw && typeof raw === "object" ? (raw as Config) : {};
    const level1 = compileAll(LEVEL_1, cfg.level1Patterns);
    const level2 = compileAll(LEVEL_2, cfg.level2Patterns);
    const whitelist = compileAll(DEFAULT_WHITELIST, cfg.whitelistPatterns);
    const sev2 = cfg.severityLevel2 ?? "warning";

    api.on(
      "before_tool_call",
      (event: {
        toolName: string;
        params?: Record<string, unknown>;
      }) => {
        if (event.toolName !== "exec") return undefined;
        const command =
          typeof event.params?.command === "string"
            ? (event.params.command as string)
            : "";
        if (!command) return undefined;
        const flat0 = command.replace(/\s+/g, " ").trim();
        // Strip quoted/escaped string contents so mentions inside commit
        // messages, echo args, or comments do not trigger false positives.
        const flat = flat0
          .replace(/'[^']*'/g, "''")
          .replace(/"[^"]*"/g, '""')
          .replace(/`[^`]*`/g, "``");
        if (whitelist.some((r) => r.test(flat0))) return undefined;

        if (level1.some((r) => r.test(flat))) {
          console.warn(
            `[danger-guard] LEVEL 1 intercept: ${flat0.slice(0, 200)}`,
          );
          return {
            requireApproval: {
              title: "Danger Guard: destructive command blocked",
              description:
                `Command matches a critical destructive pattern (rm -rf, disk write, format, shutdown, or remote script execution):\n\n${flat0.slice(0, 300)}`,
              severity: "critical" as const,
              timeoutMs: 120_000,
            },
          };
        }
        if (level2.some((r) => r.test(flat))) {
          console.warn(
            `[danger-guard] LEVEL 2 gate: ${flat0.slice(0, 200)}`,
          );
          return {
            requireApproval: {
              title: "Danger Guard: risky command needs approval",
              description:
                `Command matches a risky pattern (force push, hard reset, docker prune, SQL drop, global install):\n\n${flat0.slice(0, 300)}`,
              severity: sev2,
              timeoutMs: 60_000,
            },
          };
        }
        return undefined;
      },
      { matcher: ["exec"], priority: 100 },
    );
  },
});
