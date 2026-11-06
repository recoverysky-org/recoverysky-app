import { describe, expect, it } from "vitest"

import { MY_DAY_SCREEN, myDayRouteFor } from "./myDayNavigationLogic"

describe("myDayRouteFor (spec §4.5)", () => {
  it("maps every My Day route to a stack screen", () => {
    expect(Object.keys(MY_DAY_SCREEN).sort()).toEqual([
      "checkIn",
      "night",
      "nights",
      "routine",
      "routineItem",
      "routineNew",
      "today",
    ])
    expect(new Set(Object.values(MY_DAY_SCREEN)).size).toBe(7)
  })
  it("carries the params through", () => {
    expect(myDayRouteFor("checkIn", { typeKey: "morning" })).toEqual({
      name: "MyDayCheckIn",
      params: { typeKey: "morning" },
    })
    expect(myDayRouteFor("night", { date: "2026-11-04" })).toEqual({
      name: "MyDayNight",
      params: { date: "2026-11-04" },
    })
    expect(myDayRouteFor("today", undefined)).toEqual({ name: "MyDayToday", params: undefined })
    expect(myDayRouteFor("routineNew", { bucket: "morning" })).toEqual({
      name: "MyDayRoutineNew",
      params: { bucket: "morning" },
    })
  })
})
