import { I18nManager } from "react-native"
import * as Localization from "expo-localization"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import "intl-pluralrules"

import { logger } from "@/utils/logger"

// if English isn't your default language, move Translations to the appropriate language file.
import en, { Translations } from "./en"
import es from "./es"
import fr from "./fr"
import pt from "./pt"
import ru from "./ru"
import ar from "./ar"
import de from "./de"
import th from "./th"
import uk from "./uk"

const log = logger.child({ module: "i18n" })

const fallbackLocale = "en-US"

const systemLocales = Localization.getLocales()

const resources = { en, es, fr, pt, ru, ar, de, th, uk }
const supportedTags = Object.keys(resources)

// Language display names (in their native language)
export const languageNames: Record<string, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  de: "Deutsch",
  th: "ไทย",
  uk: "Українська",
}

// Get list of available languages
export const getAvailableLanguages = () => supportedTags

// Get current language
export const getCurrentLanguage = () => i18n.language?.split("-")[0] ?? "en"

// Change language
export const changeLanguage = async (languageCode: string) => {
  await i18n.changeLanguage(languageCode)
}

// Checks to see if the device locale matches any of the supported locales
// Device locale may be more specific and still match (e.g., en-US matches en)
const systemTagMatchesSupportedTags = (deviceTag: string) => {
  const primaryTag = deviceTag.split("-")[0]
  return supportedTags.includes(primaryTag)
}

const pickSupportedLocale: () => Localization.Locale | undefined = () => {
  return systemLocales.find((locale) => systemTagMatchesSupportedTags(locale.languageTag))
}

const locale = pickSupportedLocale()

export let isRTL = false

// Need to set RTL ASAP to ensure the app is rendered correctly. Waiting for i18n to init is too late.
if (locale?.languageTag && locale?.textDirection === "rtl") {
  I18nManager.allowRTL(true)
  isRTL = true
} else {
  I18nManager.allowRTL(false)
}

export const initI18n = async () => {
  const selectedLocale = locale?.languageTag ?? fallbackLocale
  log.info("initI18n()", {
    systemLocale: systemLocales[0]?.languageTag,
    selectedLocale,
    supportedLanguages: supportedTags.join(","),
    isRTL,
  })

  i18n.use(initReactI18next)

  await i18n.init({
    resources,
    lng: selectedLocale,
    fallbackLng: fallbackLocale,
    interpolation: {
      escapeValue: false,
    },
  })

  log.info("i18n initialized", { language: i18n.language })
  return i18n
}

/**
 * Builds up valid keypaths for translations.
 */

export type TxKeyPath = RecursiveKeyOf<Translations>

// via: https://stackoverflow.com/a/65333050
type RecursiveKeyOf<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<TObj[TKey], `${TKey}`, true>
}[keyof TObj & (string | number)]

type RecursiveKeyOfInner<TObj extends object> = {
  [TKey in keyof TObj & (string | number)]: RecursiveKeyOfHandleValue<TObj[TKey], `${TKey}`, false>
}[keyof TObj & (string | number)]

type RecursiveKeyOfHandleValue<
  TValue,
  Text extends string,
  IsFirstLevel extends boolean,
> = TValue extends any[]
  ? Text
  : TValue extends object
    ? IsFirstLevel extends true
      ? Text | `${Text}:${RecursiveKeyOfInner<TValue>}`
      : Text | `${Text}.${RecursiveKeyOfInner<TValue>}`
    : Text

// Re-export translate function
export { translate } from "./translate"
