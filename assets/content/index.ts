/**
 * Localized content barrel — selects content by current app language, defaults to English.
 */
import { getCurrentLanguage } from "@/i18n"

import { aiConsentText as aiConsentEn } from "./aiConsent.en"
import { aiConsentText as aiConsentEs } from "./aiConsent.es"
import { disclaimerText as disclaimerEn } from "./disclaimer.en"
import { disclaimerText as disclaimerEs } from "./disclaimer.es"

// Registry of localized content (add new languages here)
const content = {
  en: { aiConsent: aiConsentEn, disclaimer: disclaimerEn },
  es: { aiConsent: aiConsentEs, disclaimer: disclaimerEs },
} as Record<string, { aiConsent: string; disclaimer: string }>

function get() {
  const lang = getCurrentLanguage()
  return content[lang] ?? content.en
}

export const getAiConsentText = () => get().aiConsent
export const getDisclaimerText = () => get().disclaimer
