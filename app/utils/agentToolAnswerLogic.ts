/**
 * What a Sky tool call answered, for the Sky tab's cards.
 *
 * PURE MODULE: no runtime imports at all, so vitest can import it (see CLAUDE.md "Test Runner
 * Split").
 *
 * ADDED 2026-11-08 (routine card): moved out of `agentMeetingsLogic.ts`, where it was the meeting
 * card's private reader, because the routine card (`agentRoutineLogic.ts`) reads the same envelope.
 * Sky's MCP tools reach the phone through the agent's bridge (agent
 * `packages/tools/src/mcp/bridge.ts`) as a `dynamic-tool` part whose output is the call's MCP
 * result, `{ isError, content: [{ type: "text", text }], structuredContent? }`:
 * - meetings-mcp sends the api's JSON as the text part and no `structuredContent`;
 * - the Daily Dash MCP server sends the API's JSON as both (its README, "The tools"), and the
 *   bridge keeps `structuredContent` on the stored output.
 *
 * Parts read back from the agent are checked only for being an array (`isStoredMessage`), so the
 * output can be anything. Nothing here throws.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The answer a tool call gave: `structuredContent` when a server sends it (the bridge keeps it),
 * else the JSON in the first text part. Null for a refusal (`isError`: Sky's words carry it, and a
 * card would claim something about an answer that never came), for text that is not a JSON object,
 * and for any output that is not an MCP result at all.
 */
export function toolAnswerOf(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output) || output.isError === true) return null
  if (isRecord(output.structuredContent)) return output.structuredContent
  if (!Array.isArray(output.content)) return null
  const text = output.content.find(
    (part): part is { type: "text"; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string",
  )
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text.text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
