/**
 * Localized content barrel — selects content by current app language, defaults to English.
 */
import { getCurrentLanguage } from "@/i18n"

import { aiConsentText as aiConsentEn } from "./aiConsent.en"
import { aiConsentText as aiConsentEs } from "./aiConsent.es"
import { disclaimerText as disclaimerEn } from "./disclaimer.en"
import { disclaimerText as disclaimerEs } from "./disclaimer.es"
import { euaText as euaEn } from "./eua.en"
import { euaText as euaEs } from "./eua.es"

// Registry of localized content (add new languages here)
const content = {
  en: { aiConsent: aiConsentEn, eua: euaEn, disclaimer: disclaimerEn },
  es: { aiConsent: aiConsentEs, eua: euaEs, disclaimer: disclaimerEs },
} as Record<string, { aiConsent: string; eua: string; disclaimer: string }>

function get() {
  const lang = getCurrentLanguage()
  return content[lang] ?? content.en
}

export const getAiConsentText = () => get().aiConsent
export const getEuaText = () => get().eua
export const getDisclaimerText = () => get().disclaimer
