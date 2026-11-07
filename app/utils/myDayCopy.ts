/**
 * My Day copy through the app's i18n (spec D7, §4.7).
 *
 * `@daily-dash/my-day` takes every word it shows as one `MyDayCopy` object through its
 * provider, and its own default (`defaultMyDayCopy`) is English only. RecoverySky puts every
 * word through i18next instead, so `en.ts` (and the eight other locales) carry a `myDay`
 * namespace that mirrors `MyDayCopy` leaf for leaf, and `buildMyDayCopy(t)` rebuilds the
 * package's shape from the translator.
 *
 * The mapping rules, which the locale block's own comment repeats for translators:
 * - a string leaf is the same key path (`today.title` → `myDay:today.title`);
 * - a function leaf is an interpolation string named after its parameters
 *   (`night.position(n, total)` → `"{{n}} of {{total}}"`);
 * - a branching function is split into several keys (`checkIn.reminded[choice]`,
 *   `routine.ringDone` / `ringNotDone`, `routine.templates.addsOne` / `addsMany`);
 * - a joining function keeps its joiner as a key (`night.namesJoin`, `night.actionsJoin`),
 *   because ", " and " · " are themselves language choices;
 * - an array is an object (`today.days.sunday` …) that this builder reads back in order.
 *
 * `app/utils/myDayCopy.test.ts` walks every leaf of the package's default and fails on a
 * missing key, a differing English string, or a function leaf with no sample arguments,
 * so a word a package upgrade adds shows up as a red test, not as English leaking through.
 *
 * PURE ON PURPOSE: the vitest parity test imports this module, and vitest cannot resolve
 * the `@/` alias, so every `@/` import here must stay `import type` (erased at build).
 * The React half (`useTranslation` + `translate`) is `app/hooks/useMyDayCopy.ts`.
 *
 * ADDED 2026-11-04 (My Day tab, task 5).
 * CHANGED 2026-11-05 (my-day 0.5.0): `today.record.title`, the routine editor's glyph and
 * name leaves (`addGlyph`/`addToName`, `copyGlyph`/`copyName`, `switchOffGlyph`/`switchOffName`,
 * `editGlyph`, `emptyBucket`) and `routine.item.partsHint` are new; `today.checkIn.title`/`body`/
 * `mixUp`/`saveProblem`, the `today.tonight` block and `routine.add`/`moveUp`/`moveDown`/`editItem`
 * are gone with the today card's Record My Day panel and the editor's icon controls.
 */
import type { MyDayCopy } from "@daily-dash/my-day/copy"

import type { TxKeyPath } from "@/i18n"

/** The translator the builder reads through: `translate()` in the app, a stub in the test. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Every key path inside the `myDay` namespace, so a typo in the builder is a `tsc` error
 * rather than a raw key shown on screen (the parity test would catch it too, later).
 */
type MyDayPath = TxKeyPath extends infer K ? (K extends `myDay:${infer P}` ? P : never) : never

type ReminderChoice = Parameters<MyDayCopy["checkIn"]["reminded"]>[0]
type ReminderLine = ReturnType<MyDayCopy["checkIn"]["reminded"]>

/** Rebuilds the package's `MyDayCopy` from the app's `myDay` namespace. */
export function buildMyDayCopy(t: Translate): MyDayCopy {
  const s = (path: MyDayPath, options?: Record<string, unknown>): string =>
    t(`myDay:${path}`, options)

  return {
    today: {
      title: s("today.title"),
      loading: s("today.loading"),
      failed: s("today.failed"),
      retry: s("today.retry"),
      signOut: s("today.signOut"),
      version: (version) => s("today.version", { version }),
      crisis: {
        title: s("today.crisis.title"),
        body: s("today.crisis.body"),
        action: s("today.crisis.action"),
      },
      focal: {
        title: s("today.focal.title"),
        rating: (n) => s("today.focal.rating", { n }),
      },
      routine: {
        title: s("today.routine.title"),
        empty: s("today.routine.empty"),
      },
      buckets: {
        morning: s("today.buckets.morning"),
        afternoon: s("today.buckets.afternoon"),
        evening: s("today.buckets.evening"),
        anytime: s("today.buckets.anytime"),
        other: s("today.buckets.other"),
      },
      tick: {
        done: s("today.tick.done"),
        skipped: s("today.tick.skipped"),
        open: s("today.tick.open"),
      },
      // `n`, never `count`: i18next treats a `count` option as a plural lookup and would
      // go looking for `week_one` / `week_other`, which don't exist.
      week: (n) => s("today.week", { n }),
      record: {
        title: s("today.record.title"),
        checkInLabel: s("today.record.checkInLabel"),
        nightLabel: s("today.record.nightLabel"),
      },
      checkIn: {
        needsConnection: s("today.checkIn.needsConnection"),
        loading: s("today.checkIn.loading"),
        none: s("today.checkIn.none"),
      },
      quote: {
        title: s("today.quote.title"),
        text: (quote) => s("today.quote.text", { quote }),
        author: (name) => s("today.quote.author", { name }),
      },
      // Arrays the package indexes by Date#getDay() / getMonth(): order is load-bearing.
      days: [
        s("today.days.sunday"),
        s("today.days.monday"),
        s("today.days.tuesday"),
        s("today.days.wednesday"),
        s("today.days.thursday"),
        s("today.days.friday"),
        s("today.days.saturday"),
      ],
      months: [
        s("today.months.january"),
        s("today.months.february"),
        s("today.months.march"),
        s("today.months.april"),
        s("today.months.may"),
        s("today.months.june"),
        s("today.months.july"),
        s("today.months.august"),
        s("today.months.september"),
        s("today.months.october"),
        s("today.months.november"),
        s("today.months.december"),
      ],
    },
    checkIn: {
      title: s("checkIn.title"),
      loading: s("checkIn.loading"),
      needsConnection: s("checkIn.needsConnection"),
      notOffered: s("checkIn.notOffered"),
      retry: s("checkIn.retry"),
      someNeedConnection: s("checkIn.someNeedConnection"),
      ownWordPlaceholder: s("checkIn.ownWordPlaceholder"),
      previous: s("checkIn.previous"),
      next: s("checkIn.next"),
      done: s("checkIn.done"),
      skip: s("checkIn.skip"),
      close: s("checkIn.close"),
      support: s("checkIn.support"),
      crisis: {
        title: s("checkIn.crisis.title"),
        body: s("checkIn.crisis.body"),
        action: s("checkIn.crisis.action"),
      },
      supportCard: {
        title: s("checkIn.supportCard.title"),
        body: s("checkIn.supportCard.body"),
        action: s("checkIn.supportCard.action"),
      },
      oneMoment: s("checkIn.oneMoment"),
      saveProblem: s("checkIn.saveProblem"),
      thanks: s("checkIn.thanks"),
      waiting: s("checkIn.waiting"),
      refused: s("checkIn.refused"),
      tooLate: s("checkIn.tooLate"),
      sendAgain: s("checkIn.sendAgain"),
      discard: s("checkIn.discard"),
      discardProblem: s("checkIn.discardProblem"),
      backToToday: s("checkIn.backToToday"),
      exit: {
        title: s("checkIn.exit.title"),
        body: s("checkIn.exit.body"),
        enough: s("checkIn.exit.enough"),
        remind: s("checkIn.exit.remind"),
        keepGoing: s("checkIn.exit.keepGoing"),
        choice: {
          "1h": s("checkIn.exit.choice.1h"),
          "3h": s("checkIn.exit.choice.3h"),
          "tomorrow_morning": s("checkIn.exit.choice.tomorrow_morning"),
        },
      },
      // The package types this as a union of its three English sentences; a translated
      // sentence is none of them, so the cast is the honest widening, not a lie about
      // the value. The key per choice mirrors `exit.choice` above.
      reminded: (choice: ReminderChoice) =>
        s(
          choice === "1h"
            ? "checkIn.reminded.1h"
            : choice === "3h"
              ? "checkIn.reminded.3h"
              : "checkIn.reminded.tomorrow_morning",
        ) as ReminderLine,
    },
    gratitude: {
      title: s("gratitude.title"),
      empty: s("gratitude.empty"),
      field: s("gratitude.field"),
      placeholder: s("gratitude.placeholder"),
      add: s("gratitude.add"),
      refused: s("gratitude.refused"),
      dismiss: s("gratitude.dismiss"),
      saveProblem: s("gratitude.saveProblem"),
    },
    night: {
      title: s("night.title"),
      stepsTitle: s("night.stepsTitle"),
      loading: s("night.loading"),
      unreadable: s("night.unreadable"),
      needsConnection: s("night.needsConnection"),
      retry: s("night.retry"),
      position: (n, total) => s("night.position", { n, total }),
      previous: s("night.previous"),
      next: s("night.next"),
      done: s("night.done"),
      support: s("night.support"),
      rateLabel: (n) => s("night.rateLabel", { n }),
      rateQuestion: s("night.rateQuestion"),
      anchorHigh: (text) => s("night.anchorHigh", { text }),
      anchorLow: (text) => s("night.anchorLow", { text }),
      did: s("night.did"),
      suggests: s("night.suggests"),
      intentLine: (i) => s("night.intentLine", { current: i.current, goal: i.goal }),
      // The default lowercases the pillar name mid-sentence ("your sleep"); doing it here
      // keeps that parity. toLocaleLowerCase, as the default does, so Turkish-style
      // casing follows the device locale.
      tellSky: (pillarName) => s("night.tellSky", { pillar: pillarName.toLocaleLowerCase() }),
      withoutIntent: (names) =>
        s("night.withoutIntent", { names: names.join(s("night.namesJoin")) }),
      note: s("night.note"),
      notePlaceholder: s("night.notePlaceholder"),
      gratitude: s("night.gratitude"),
      line: s("night.line"),
      linePlaceholder: s("night.linePlaceholder"),
      list: s("night.list"),
      useAsLine: (entry) => s("night.useAsLine", { entry }),
      listAdd: s("night.listAdd"),
      listAddButton: s("night.listAddButton"),
      listChange: (entry) => s("night.listChange", { entry }),
      listSave: s("night.listSave"),
      listDelete: (entry) => s("night.listDelete", { entry }),
      listUseLabel: s("night.listUseLabel"),
      listChangeLabel: s("night.listChangeLabel"),
      listDeleteLabel: s("night.listDeleteLabel"),
      listCancel: s("night.listCancel"),
      focal: (names) => s("night.focal", { names: names.join(s("night.namesJoin")) }),
      lineShown: (line) => s("night.lineShown", { line }),
      hidden: s("night.hidden"),
      waiting: s("night.waiting"),
      edit: s("night.edit"),
      delete: s("night.delete"),
      deleteQuestion: s("night.deleteQuestion"),
      deleteYes: s("night.deleteYes"),
      keep: s("night.keep"),
      pastNights: s("night.pastNights"),
      notRated: s("night.notRated"),
      saveProblem: s("night.saveProblem"),
      refused: s("night.refused"),
      tooLate: s("night.tooLate"),
      discardNote: s("night.discardNote"),
      sendAgain: s("night.sendAgain"),
      discard: s("night.discard"),
      discardProblem: s("night.discardProblem"),
      actionsShown: (titles) =>
        s("night.actionsShown", { titles: titles.join(s("night.actionsJoin")) }),
      crisis: {
        title: s("night.crisis.title"),
        body: s("night.crisis.body"),
        action: s("night.crisis.action"),
      },
      card: {
        rate: s("night.card.rate"),
        see: s("night.card.see"),
      },
      nights: {
        title: s("night.nights.title"),
        loading: s("night.nights.loading"),
        needsConnection: s("night.nights.needsConnection"),
        unreadable: s("night.nights.unreadable"),
        previous: s("night.nights.previous"),
        next: s("night.nights.next"),
        // Calendar column heads, Sunday first, matching `today.days`.
        weekdays: [
          s("night.nights.weekdays.sun"),
          s("night.nights.weekdays.mon"),
          s("night.nights.weekdays.tue"),
          s("night.nights.weekdays.wed"),
          s("night.nights.weekdays.thu"),
          s("night.nights.weekdays.fri"),
          s("night.nights.weekdays.sat"),
        ],
        rated: s("night.nights.rated"),
        care: s("night.nights.care"),
        notRated: s("night.nights.notRated"),
        day: (heading, state) => s("night.nights.day", { heading, state }),
      },
    },
    quote: {
      favourite: s("quote.favourite"),
      favourited: s("quote.favourited"),
      favouriteName: s("quote.favouriteName"),
      favouritedName: s("quote.favouritedName"),
      refused: s("quote.refused"),
      dismiss: s("quote.dismiss"),
      saveProblem: s("quote.saveProblem"),
    },
    routine: {
      title: s("routine.title"),
      loading: s("routine.loading"),
      failed: s("routine.failed"),
      retry: s("routine.retry"),
      start: s("routine.start"),
      edit: s("routine.edit"),
      editLabel: s("routine.editLabel"),
      // One function, two sentences: the done state flips the verb's object, which word
      // order in other languages may not express as a single template.
      ring: (title, done) => s(done ? "routine.ringDone" : "routine.ringNotDone", { title }),
      pending: s("routine.pending"),
      saveProblem: s("routine.saveProblem"),
      longRoutine: s("routine.longRoutine"),
      refused: s("routine.refused"),
      tooLate: s("routine.tooLate"),
      discardNote: s("routine.discardNote"),
      sendAgain: s("routine.sendAgain"),
      discard: s("routine.discard"),
      discardProblem: s("routine.discardProblem"),
      addGlyph: s("routine.addGlyph"),
      addToName: (part) => s("routine.addToName", { part }),
      copyGlyph: s("routine.copyGlyph"),
      switchOffGlyph: s("routine.switchOffGlyph"),
      editGlyph: s("routine.editGlyph"),
      emptyBucket: s("routine.emptyBucket"),
      moveUpName: (title) => s("routine.moveUpName", { title }),
      moveDownName: (title) => s("routine.moveDownName", { title }),
      copyName: (title) => s("routine.copyName", { title }),
      switchOffName: (title) => s("routine.switchOffName", { title }),
      unknownBucket: s("routine.unknownBucket"),
      editName: (title) => s("routine.editName", { title }),
      switchedOff: {
        title: s("routine.switchedOff.title"),
        onGlyph: s("routine.switchedOff.onGlyph"),
        name: (title) => s("routine.switchedOff.name", { title }),
        hideGlyph: s("routine.switchedOff.hideGlyph"),
        hideName: (title) => s("routine.switchedOff.hideName", { title }),
      },
      templates: {
        title: s("routine.templates.title"),
        show: s("routine.templates.show"),
        loading: s("routine.templates.loading"),
        needsConnection: s("routine.templates.needsConnection"),
        apply: s("routine.templates.apply"),
        // Two keys rather than i18next plurals: the default's own branch is exactly
        // one-vs-many, and a `count` option would send i18next to `_one` / `_other`
        // suffixed keys this namespace doesn't carry.
        adds: (n) =>
          n === 1 ? s("routine.templates.addsOne") : s("routine.templates.addsMany", { n }),
        unreadable: s("routine.templates.unreadable"),
        applyProblem: s("routine.templates.applyProblem"),
        back: s("routine.templates.back"),
      },
      item: {
        newTitle: s("routine.item.newTitle"),
        editTitle: s("routine.item.editTitle"),
        title: s("routine.item.title"),
        titlePlaceholder: s("routine.item.titlePlaceholder"),
        bucket: s("routine.item.bucket"),
        partsHint: s("routine.item.partsHint"),
        time: s("routine.item.time"),
        timePlaceholder: s("routine.item.timePlaceholder"),
        noTime: s("routine.item.noTime"),
        timeProblem: s("routine.item.timeProblem"),
        save: s("routine.item.save"),
        switchOff: s("routine.item.switchOff"),
        switchOffNote: s("routine.item.switchOffNote"),
        unknown: s("routine.item.unknown"),
      },
    },
    sky: {
      name: s("sky.name"),
      notNow: s("sky.notNow"),
      talkToSky: s("sky.talkToSky"),
      talk: s("sky.talk"),
      schedule: {
        empty: s("sky.schedule.empty"),
        stale: s("sky.schedule.stale"),
      },
      help: s("sky.help"),
      askForHelp: s("sky.askForHelp"),
      helpGlyph: s("sky.helpGlyph"),
      sparkleGlyph: s("sky.sparkleGlyph"),
    },
    screen: {
      back: s("screen.back"),
      backGlyph: s("screen.backGlyph"),
    },
  }
}
