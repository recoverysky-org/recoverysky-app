import { render, screen } from "@testing-library/react-native"

import { formatMillisToLocalTime } from "@/utils/formatTime"

import { ScheduleGrid } from "./ScheduleGrid"

// test/setup.ts stubs i18n globally to echo "<key> <params-json>", which is
// fine for tests that only need a component not to crash. This file is
// specifically about what a screen reader SAYS, so it resolves against the
// real `en` catalogue instead: that way an assertion failure reads as English,
// a typo'd key surfaces as a missing translation rather than a passing echo,
// and a renamed interpolation placeholder ({{day}} → {{weekday}}) actually
// fails. Only react-i18next is overridden — the rest of setup.ts still applies.
jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    // Top level is namespace-separated, deeper levels are dot-separated —
    // matches the TxKeyPath type in app/i18n/index.ts.
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

// UNSAFE_root.findAll's predicate parameter comes back untyped under
// noImplicitAny, and react-test-renderer ships no declarations (there is no
// @types/react-test-renderer installed, and it isn't worth a devDependency for
// one annotation). Only `type` and `props` are read here, so declare that much.
type A11yNode = { type: unknown; props: Record<string, unknown> }

// One row, meetings on Monday (col 0) and Wednesday (col 2), the rest empty.
// The empty columns are the point of several assertions below — a real grid is
// mostly empty, and those spacers used to be focusable.
const MON = new Date(2026, 7, 3, 19, 0).getTime()
const WED = new Date(2026, 7, 5, 12, 30).getTime()

const oneRow = [
  [{ millis: MON, id: "mon" }, null, { millis: WED, id: "wed" }, null, null, null, null],
]

describe("ScheduleGrid accessibility", () => {
  describe("cell labels", () => {
    it("restates the day, which is otherwise only a column position", () => {
      render(<ScheduleGrid scheduleData={oneRow} onCellPress={jest.fn()} />)
      // The visible cell text is just the time; a screen reader has no way to
      // see which column it sits in, so the label has to carry the day.
      expect(screen.getByLabelText(`Monday, ${formatMillisToLocalTime(MON)}`)).toBeTruthy()
      expect(screen.getByLabelText(`Wednesday, ${formatMillisToLocalTime(WED)}`)).toBeTruthy()
    })

    it("speaks reminder state, which is otherwise carried only by fill colour", () => {
      render(
        <ScheduleGrid
          scheduleData={oneRow}
          onCellPress={jest.fn()}
          reminderCells={
            new Map([
              ["0-0", "enabled"],
              ["0-2", "disabled"],
            ])
          }
        />,
      )
      expect(
        screen.getByLabelText(`Monday, ${formatMillisToLocalTime(MON)}, reminder on`),
      ).toBeTruthy()
      expect(
        screen.getByLabelText(`Wednesday, ${formatMillisToLocalTime(WED)}, reminder off`),
      ).toBeTruthy()
    })

    it("spells out the 24h sentinel rather than announcing the glyph", () => {
      // millis === 0 renders visually as the string "24h", which a screen
      // reader would say as "twenty-four h".
      render(
        <ScheduleGrid
          scheduleData={[[{ millis: 0, id: "c" }, null, null, null, null, null, null]]}
        />,
      )
      expect(screen.getByLabelText("Monday, runs continuously, 24 hours")).toBeTruthy()
    })
  })

  describe("hints", () => {
    it("promises editing when a reminder exists and creation when it doesn't", () => {
      render(
        <ScheduleGrid
          scheduleData={oneRow}
          onCellPress={jest.fn()}
          reminderCells={new Map([["0-0", "enabled"]])}
        />,
      )
      const withReminder = screen.getByLabelText(
        `Monday, ${formatMillisToLocalTime(MON)}, reminder on`,
      )
      const without = screen.getByLabelText(`Wednesday, ${formatMillisToLocalTime(WED)}`)
      expect(withReminder.props.accessibilityHint).toBe("Double-tap to edit this reminder")
      expect(without.props.accessibilityHint).toBe("Double-tap to set a reminder")
    })
  })

  describe("empty cells", () => {
    it("explicitly hides spacers on both platforms", () => {
      // Regression guard: with 7 columns and only 2 meetings, 5 spacers sit
      // between the real times in every row. iOS honours
      // accessibilityElementsHidden and Android honours
      // importantForAccessibility — both are needed, so assert both rather
      // than trusting that an empty View happens to be unfocusable.
      render(<ScheduleGrid scheduleData={oneRow} onCellPress={jest.fn()} />)
      const hidden = screen.UNSAFE_root.findAll(
        // `typeof type === "string"` keeps host elements only. Without it each
        // spacer matches twice — once as the RN <View> composite and once as
        // the host view it renders — which reads as double the real count.
        (node: A11yNode) =>
          typeof node.type === "string" && node.props?.accessibilityElementsHidden === true,
      )
      expect(hidden).toHaveLength(5)
      hidden.forEach((node: A11yNode) =>
        expect(node.props.importantForAccessibility).toBe("no-hide-descendants"),
      )
    })

    it("leaves no reachable element unlabelled", () => {
      // Complements the count above: whatever IS focusable must say something.
      render(<ScheduleGrid scheduleData={oneRow} onCellPress={jest.fn()} />)
      const reachable = screen.UNSAFE_root.findAll(
        (node: A11yNode) =>
          node.props?.accessible === true || node.props?.accessibilityRole === "button",
      )
      expect(reachable.length).toBeGreaterThan(0)
      expect(reachable.filter((node: A11yNode) => !node.props.accessibilityLabel)).toHaveLength(0)
    })
  })

  describe("header", () => {
    it("announces full day names and marks today", () => {
      // currentDow is an ISO weekday: 3 === Wednesday.
      render(<ScheduleGrid scheduleData={oneRow} currentDow={3} />)
      expect(screen.getByLabelText("Wednesday, today")).toBeTruthy()
      // Non-current days announce plainly. "Monday" also matches a cell label
      // prefix, so query the header by its exact string.
      expect(screen.getByLabelText("Monday")).toBeTruthy()
    })
  })

  describe("read-only grids", () => {
    it("still labels cells when there is no onCellPress", () => {
      // ReminderEditorModal and the popups both render read-only grids; the
      // day/time pairing matters there too, it just isn't a button.
      render(<ScheduleGrid scheduleData={oneRow} />)
      const cell = screen.getByLabelText(`Monday, ${formatMillisToLocalTime(MON)}`)
      expect(cell.props.accessibilityRole).toBeUndefined()
    })
  })
})
