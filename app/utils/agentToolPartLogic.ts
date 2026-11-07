/**
 * How the Sky tab draws a message part that is a tool call.
 *
 * PURE MODULE: no runtime imports at all, so vitest can import it (see CLAUDE.md
 * "Test Runner Split"). AgentScreen renders what this answers: `result` through
 * ToolResultRenderer, `running` as the "Using…" badge, `finished` as a badge with
 * a checkmark, and null as nothing.
 *
 * ADDED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md, D9). The thread
 * is now read back from the agent, which brings parts this screen never saw while it
 * only held its own: a stored reply's finished states, and rows from before the agent
 * stored parts. A "Using…" badge is only true while a reply streams, so anything else
 * read back must not draw one, or it spins for good.
 *
 * Parts read from the agent are checked only for being an array (`isStoredMessage`),
 * so a part can be `null`, a primitive or the wrong shape whatever the signature says.
 * Junk answers null here rather than throwing during a render.
 */

export type ToolPartView =
  | { kind: "result"; toolCallId: string; toolName: string; output: unknown }
  | { kind: "finished"; toolName: string }
  | { kind: "running"; toolName: string }

/** The name to show when a part gives none, the same fallback the screen always used. */
const UNNAMED_TOOL = "tool"

/** The part type of a row stored without parts, from the agent's `toUIMessage`. */
const LEGACY_TYPE = "tool-invocation"

/** The prefix of a static tool's part type, `tool-{toolName}`. */
const STATIC_PREFIX = "tool-"

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

/**
 * A finished call with something to draw, or a finished badge when it has not.
 *
 * ToolResultRenderer keys its collapse state on `toolCallId`, so a part with none can
 * draw no card. A null output has nothing for a card to show either. `0`, `""` and
 * `false` are outputs like any other. The old screen's truthiness check sent every
 * empty or falsy output to "Using…" for good.
 */
function finishedView(toolCallId: unknown, toolName: string, output: unknown): ToolPartView {
  const id = nonEmptyString(toolCallId)
  return id !== null && output !== null && output !== undefined
    ? { kind: "result", toolCallId: id, toolName, output }
    : { kind: "finished", toolName }
}

/**
 * Decide how to draw a part. Null for anything that is not a tool call.
 *
 * Checked before the static prefix: `tool-invocation` also starts with `tool-`, and
 * the old prefix check read it as a tool called "invocation" with no output, showing
 * "Using invocation…" for good. Such a row is history, so it is never running: its
 * `state` only says whether a result was stored (`"result"`, or `"call"` with none),
 * and the presence of the result says the same thing. `toolName` comes from the field.
 */
export function classifyToolPart(part: {
  type: string
  [key: string]: unknown
}): ToolPartView | null {
  if (typeof part !== "object" || part === null || typeof part.type !== "string") return null

  if (part.type === LEGACY_TYPE) {
    const toolName = nonEmptyString(part.toolName) ?? UNNAMED_TOOL
    return finishedView(part.toolInvocationId, toolName, part.result)
  }

  let toolName: string
  if (part.type === "dynamic-tool") {
    toolName = nonEmptyString(part.toolName) ?? UNNAMED_TOOL
  } else if (part.type.startsWith(STATIC_PREFIX)) {
    toolName = nonEmptyString(part.type.slice(STATIC_PREFIX.length)) ?? UNNAMED_TOOL
  } else {
    // text, step-start, data-*, source-*, file, reasoning: drawn elsewhere or not at all.
    return null
  }

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return { kind: "running", toolName }
    case "output-available":
      return finishedView(part.toolCallId, toolName, part.output)
    case "output-error":
    case "output-denied":
      return { kind: "finished", toolName }
    default:
      // Includes approval-requested and approval-responded. This screen has no approval
      // cards (spec D8), so neither has anything true to draw: "Using addReminder…" spins
      // for good on a card nobody here can answer, and "addReminder finished" claims
      // something that was not done. Sky's words around the card still show. A state the
      // SDK adds later lands here too, and draws nothing until someone decides.
      return null
  }
}
