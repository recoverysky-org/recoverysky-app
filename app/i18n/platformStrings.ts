/**
 * Platform-specific i18n overrides (Android / Web)
 *
 * Metro bundles this file for Android and Web builds.
 * iOS gets platformStrings.ios.ts (empty) instead, so these
 * strings never appear in the iOS JS bundle.
 */
export const platformStrings: Record<string, Record<string, Record<string, string>>> = {
  en: { loginScreen: { continueAnonymously: "Continue Anonymously" } },
  es: { loginScreen: { continueAnonymously: "Continuar Anónimamente" } },
  fr: { loginScreen: { continueAnonymously: "Continuer de façon anonyme" } },
  pt: { loginScreen: { continueAnonymously: "Continuar Anonimamente" } },
  ru: { loginScreen: { continueAnonymously: "Продолжить анонимно" } },
  ar: { loginScreen: { continueAnonymously: "المتابعة بشكل مجهول" } },
  de: { loginScreen: { continueAnonymously: "Anonym fortfahren" } },
  th: { loginScreen: { continueAnonymously: "ใช้งานแบบไม่ระบุตัวตน" } },
  uk: { loginScreen: { continueAnonymously: "Продовжити анонімно" } },
}
