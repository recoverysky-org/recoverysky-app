import { defaultMyDayCopy } from "@daily-dash/my-day/copy"
import { describe, expect, it } from "vitest"

import { buildMyDayCopy } from "./myDayCopy"
import en from "../i18n/en"

/** The sample arguments the parity check calls each function leaf with, by its path. */
const SAMPLE_ARGS: Record<string, unknown[][]> = {
  "today.version": [["1.2.3"]],
  "today.focal.rating": [[4]],
  "today.week": [[0], [3]],
  "today.quote.text": [["Keep going"]],
  "today.quote.author": [["Someone"]],
  "checkIn.reminded": [["1h"], ["3h"], ["tomorrow_morning"]],
  "night.position": [[2, 5]],
  "night.rateLabel": [[3]],
  "night.anchorHigh": [["rested"]],
  "night.anchorLow": [["wrecked"]],
  "night.intentLine": [[{ current: "6 h", goal: "8 h" }]],
  "night.tellSky": [["Sleep"]],
  "night.withoutIntent": [[["Sleep", "Food"]], [[]]],
  "night.useAsLine": [["sun"]],
  "night.listChange": [["sun"]],
  "night.listDelete": [["sun"]],
  "night.focal": [[["Sleep", "Food"]]],
  "night.lineShown": [["sun"]],
  "night.actionsShown": [[["Walk", "Call"]]],
  "night.nights.day": [["Tuesday 6", "rated"]],
  "routine.ring": [
    ["Walk", true],
    ["Walk", false],
  ],
  "routine.skipName": [["Walk"]],
  "routine.undoName": [["Walk"]],
  "routine.addToName": [["Morning"]],
  "routine.moveUpName": [["Walk"]],
  "routine.moveDownName": [["Walk"]],
  "routine.editName": [["Walk"]],
  "routine.copyName": [["Walk"]],
  "routine.switchOffName": [["Walk"]],
  "routine.switchedOff.name": [["Walk"]],
  "routine.templates.adds": [[1], [4]],
}

const lookup = (key: string): string => {
  const [ns, path] = key.split(":")
  const value = path
    .split(".")
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown>)?.[k],
      (en as Record<string, unknown>)[ns],
    )
  if (typeof value !== "string") throw new Error(`en.ts has no string at ${key}`)
  return value
}
const t = (key: string, options?: Record<string, unknown>): string =>
  lookup(key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name]))

type Leaf = string | ((...a: never[]) => string)
const walk = (node: unknown, path: string, visit: (path: string, leaf: unknown) => void): void => {
  if (typeof node === "string" || typeof node === "function" || Array.isArray(node))
    return visit(path, node)
  for (const [k, v] of Object.entries(node as Record<string, unknown>))
    walk(v, path ? `${path}.${k}` : k, visit)
}
const get = (root: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root)

describe("buildMyDayCopy (spec D7, §4.7): English parity with the package's default", () => {
  const built = buildMyDayCopy(t)
  const leaves: string[] = []
  walk(defaultMyDayCopy, "", (path) => leaves.push(path))

  it("covers every leaf", () => {
    expect(leaves.length).toBeGreaterThan(150)
  })
  it.each(leaves)("%s", (path) => {
    const expected = get(defaultMyDayCopy, path) as Leaf | string[]
    const actual = get(built, path) as Leaf | string[]
    if (typeof expected === "function") {
      const samples = SAMPLE_ARGS[path]
      expect(samples, `add SAMPLE_ARGS["${path}"]`).toBeDefined()
      for (const args of samples)
        expect((actual as (...a: unknown[]) => string)(...args)).toBe(
          (expected as (...a: unknown[]) => string)(...args),
        )
    } else {
      expect(actual).toEqual(expected)
    }
  })
})
