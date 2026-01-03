// Note the syntax of these imports from the date-fns library.
// If you import with the syntax: import { format } from "date-fns" the ENTIRE library
// will be included in your production bundle (even if you only use one function).
// This is because react-native does not support tree-shaking.
import { format } from "date-fns/format"
import type { Locale } from "date-fns/locale"
import { parseISO } from "date-fns/parseISO"
import i18n from "i18next"

import { logger } from "./logger"

const log = logger.child({ module: "formatDate" })

type Options = Parameters<typeof format>[2]

let dateFnsLocale: Locale
// Helper to safely get locale from require (handles both default and named exports)
const getLocale = (mod: { default?: Locale } | Locale): Locale => {
  return "default" in mod && mod.default ? mod.default : (mod as Locale)
}

export const loadDateFnsLocale = () => {
  const primaryTag = i18n.language?.split("-")[0] ?? "en"
  log.info("loadDateFnsLocale()", { i18nLanguage: i18n.language, primaryTag })

  switch (primaryTag) {
    case "en":
      dateFnsLocale = getLocale(require("date-fns/locale/en-US"))
      break
    case "ar":
      dateFnsLocale = getLocale(require("date-fns/locale/ar"))
      break
    case "ko":
      dateFnsLocale = getLocale(require("date-fns/locale/ko"))
      break
    case "es":
      dateFnsLocale = getLocale(require("date-fns/locale/es"))
      break
    case "fr":
      dateFnsLocale = getLocale(require("date-fns/locale/fr"))
      break
    case "hi":
      dateFnsLocale = getLocale(require("date-fns/locale/hi"))
      break
    case "ja":
      dateFnsLocale = getLocale(require("date-fns/locale/ja"))
      break
    default:
      dateFnsLocale = getLocale(require("date-fns/locale/en-US"))
      break
  }

  log.info("date-fns locale loaded", { locale: dateFnsLocale?.code ?? "unknown" })
}

export const formatDate = (date: string, dateFormat?: string, options?: Options) => {
  const dateOptions = {
    ...options,
    locale: dateFnsLocale,
  }
  return format(parseISO(date), dateFormat ?? "MMM dd, yyyy", dateOptions)
}
