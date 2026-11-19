/**
 * Where support contacts show. ADDED 2026-11-19 (Jenova): both are hidden for now, for everyone.
 *
 * Hiding deletes nothing. Saved contacts stay in SecureStore (`support_contacts_v1`), the loader
 * still reads them, and the clears (Delete User Data, the database overlay's Reset, the fresh-
 * install clear) still run. Set a flag back to true to bring that surface back as it was.
 *
 * Constants in their own module, not locals, so the Support screen's jest tests can mock them on.
 * No `@/` imports.
 */

/** The Home tab's Support card (contacts, call and text, + and edit). */
export const SUPPORT_HOME_CARD_ENABLED = false

/**
 * The contact rows and "Add a support contact" on the Support screen. The screen itself stays,
 * with "Find a live meeting now" and the 988 line; it is reached from My Day (`openCrisisPath`).
 */
export const SUPPORT_CONTACTS_ENABLED = false
