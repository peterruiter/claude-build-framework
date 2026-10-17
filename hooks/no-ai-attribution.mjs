#!/usr/bin/env node
// ===========================================================================
// PreToolUse guard (Bash and PowerShell): blocks `git commit`, `gh pr
// create|edit|merge` and `gh release create|edit` commands whose message, body
// or notes carry AI attribution: a Co-Authored-By trailer naming an AI
// assistant, a "Generated with/by <AI tool>" line, or the robot emoji. The rule
// is "no AI attribution anywhere"; this makes it hold even when a tool's default
// adds such a line.
//
// Input: the hook JSON on stdin (tool_name, tool_input.command, cwd).
// Output: exit 2 with the reason on stderr to block; exit 0 otherwise.
// Files named by -F/--file, --body-file or --notes-file are read too.
// Node's own modules only; any failure to parse lets the command through.
// ===========================================================================
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assistants = String.raw`claude|anthropic|copilot|chatgpt|openai|gpt-?\d|gemini|codeium|cursor|tabnine|amazon q|codewhisperer|an? ai\b|ai assistant`;

const patterns = [
  { name: 'a Co-Authored-By trailer naming an AI assistant', pattern: new RegExp(String.raw`^.*co-authored-by:.*\b(?:${assistants}).*$`, 'im') },
  { name: 'a Co-Authored-By trailer with an AI vendor address', pattern: /^.*co-authored-by:.*@(?:anthropic|openai)\.com.*$/im },
  { name: 'a "Generated with/by" line naming an AI tool', pattern: new RegExp(String.raw`^.*\b(?:generated|written|created|made)\s+(?:with|by|using)\s*\[?\s*(?:${assistants}).*$`, 'im') },
  { name: 'the robot emoji attribution', pattern: /^.*\u{1F916}.*$/mu },
];

/** The first AI attribution in a text: { name, line } or null. */
export function findAttribution(text) {
  for (const { name, pattern } of patterns) {
    const match = pattern.exec(String(text ?? ''));
    if (match) return { name, line: match[0].trim().slice(0, 160) };
  }
  return null;
}

/** What kind of outward text a command writes, or null when it is not one we guard. */
export function guardedKind(command) {
  const text = String(command ?? '');
  if (/\bgit\b(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/.test(text)) return 'commit message';
  if (/\bgh\s+pr\s+(?:create|edit|merge|comment)\b/.test(text)) return 'pull request text';
  if (/\bgh\s+release\s+(?:create|edit)\b/.test(text)) return 'release notes';
  if (/\bgh\s+issue\s+(?:create|edit|comment)\b/.test(text)) return 'issue text';
  return null;
}

/** Files a command takes its message or body from: -F x, --file x, --body-file x, --notes-file x (and = forms). */
export function messageFiles(command) {
  const files = [];
  const pattern = /(?:^|\s)(?:-F|--file|--body-file|--notes-file)(?:\s+|=)("([^"]+)"|'([^']+)'|(\S+))/g;
  for (const match of String(command ?? '').matchAll(pattern)) {
    const file = match[2] ?? match[3] ?? match[4];
    if (file && file !== '-') files.push(file);
  }
  return files;
}

/** The decision for one hook input: { block: false } or { block: true, reason }. */
export function inspect(input, read = (path) => readFileSync(path, 'utf8')) {
  if (!input || !['Bash', 'PowerShell'].includes(input.tool_name)) return { block: false };
  const command = input.tool_input?.command;
  const kind = guardedKind(command);
  if (!kind) return { block: false };
  let text = String(command);
  for (const file of messageFiles(command)) {
    const path = resolve(input.cwd ?? process.cwd(), file);
    try { if (existsSync(path)) text += `\n${read(path)}`; } catch { /* unreadable: judge the command alone */ }
  }
  const found = findAttribution(text);
  if (!found) return { block: false };
  return {
    block: true,
    reason: `Blocked by build-framework: this ${kind} contains ${found.name} ("${found.line}"). `
      + 'The standing rule is no AI attribution anywhere (commits, pull requests, release notes, docs). '
      + 'Remove that line and run the command again.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch { process.exit(0); }
    const decision = inspect(input);
    if (decision.block) {
      process.stderr.write(decision.reason + '\n');
      process.exit(2);
    }
    process.exit(0);
  });
}
