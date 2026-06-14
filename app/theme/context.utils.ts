import type { Theme } from "./types"

const systemui = require("expo-system-ui")

/**
 * Set the system UI background color to the given color. This is only available if the app has
 * installed expo-system-ui.
 *
 * @param color The color to set the system UI background to
 */
export const setSystemUIBackgroundColor = (color: string) => {
  if (systemui) {
    // Best-effort, fire-and-forget. ExpoSystemUI.setBackgroundColorAsync
    // rejects with "The current activity is no longer available" during a
    // background→active resume race (the Activity isn't reattached yet when
    // ThemeContext re-applies imperative theming on foreground). The color
    // re-applies on the next theme pass, so swallow the transient rejection
    // rather than let it float — an un-.catch()'d rejection here surfaced in
    // Sentry as a fatal Error on 4.5.0.
    systemui.setBackgroundColorAsync(color).catch(() => {})
  }
}

/**
 * Set the app's native background color to match the theme.
 * This is only available if the app has installed expo-system-ui
 *
 * @param theme The theme object to use for the background color
 */
export const setImperativeTheming = (theme: Theme) => {
  setSystemUIBackgroundColor(theme.colors.background)
}
