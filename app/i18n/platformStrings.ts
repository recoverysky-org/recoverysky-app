/**
 * Platform-specific i18n overrides (Android / Web)
 *
 * Metro bundles this file for Android and Web builds.
 * iOS gets platformStrings.ios.ts (empty) instead, so these
 * strings never appear in the iOS JS bundle.
 *
 * ADDED 2026-10-11: the guest-mode entry "Just join meetings" (spec
 * 2026-09-27-guest-mode-design.md, decision 4). Every locale file carries
 * `loginScreen.justJoinMeetings: ""` and this map supplies the text (merged in
 * app/i18n/index.ts). LoginScreen renders the button on Android only, so web
 * bundles the string but never shows it.
 */
export const platformStrings: Record<string, Record<string, Record<string, string>>> = {
  en: { loginScreen: { justJoinMeetings: "Just join meetings" } },
  es: { loginScreen: { justJoinMeetings: "Solo unirme a reuniones" } },
  fr: { loginScreen: { justJoinMeetings: "Juste rejoindre des réunions" } },
  pt: { loginScreen: { justJoinMeetings: "Só entrar em reuniões" } },
  ru: { loginScreen: { justJoinMeetings: "Просто присоединиться к собраниям" } },
  ar: { loginScreen: { justJoinMeetings: "الانضمام إلى الاجتماعات فقط" } },
  de: { loginScreen: { justJoinMeetings: "Nur an Meetings teilnehmen" } },
  th: { loginScreen: { justJoinMeetings: "เข้าร่วมการประชุมเท่านั้น" } },
  uk: { loginScreen: { justJoinMeetings: "Просто приєднатися до зустрічей" } },
}
