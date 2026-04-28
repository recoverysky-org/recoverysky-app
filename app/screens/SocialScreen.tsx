/**
 * SocialScreen
 *
 * In-app browser window to the Replyke-hosted RecoverySky social site.
 * The native shell owns identity (Auth0 on RN side) and injects a pre-signed
 * Replyke JWT into the WebView; Auth0 never enters the WebView.
 *
 * Messages posted into the WebView:
 *   - { type: "replyke_token", token } — signed Replyke JWT for ReplykeProvider
 *   - { type: "app_context", mode, themeColor, shortName } — visual + identity
 *     context so the SPA can match the host app's appearance and personalize
 *     posts. `mode` is "dark" | "light"; `themeColor` is a hex string (the
 *     user-picked tint, or the app default if unset); `shortName` is the
 *     user's display name from ProfileStore (may be empty before hydration).
 *
 * Handshake: the web app must post `{ type: "replyke_ready" }` back via
 * window.ReactNativeWebView.postMessage once its message listener is
 * attached. RN injects the token + app_context in response, avoiding a
 * race where messages posted at onLoadEnd are dropped before React has
 * committed and effects have flushed.
 */

import { FC, useCallback, useEffect, useMemo, useRef } from "react"
import { ActivityIndicator, Platform, StyleSheet, View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import WebView, { type WebViewMessageEvent } from "react-native-webview"

import { Screen } from "@/components/Screen"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "SocialScreen" })

type InjectedMessage =
  | { type: "replyke_token"; token: string }
  | {
      type: "app_context"
      mode: "dark" | "light"
      themeColor: string
      shortName: string
    }

export const SocialScreen: FC<MainTabScreenProps<"Social">> = observer(function SocialScreen() {
  const {
    themed,
    theme: { colors },
    themeContext,
  } = useAppTheme()
  const configStore = useConfigStore()
  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const webViewRef = useRef<WebView>(null)
  const isReadyRef = useRef(false)
  // Coalesces concurrent mint requests. The web side may issue multiple
  // `replyke_token_request` messages (e.g. several queued API calls discover
  // expiry simultaneously). We only want one POST /api/replyke/sign-token in
  // flight at a time; the resulting token is broadcast via postMessage and
  // every awaiting web-side caller receives it through the same listener.
  const tokenRequestInFlight = useRef(false)

  const socialUrl = configStore.socialUrl
  const userIdentifier = authStore.userIdentifier
  // ProfileStore stores empty string when the user hasn't picked a custom
  // tint — fall back to the app's default so the SPA always has a usable
  // hex value (no need to handle empty/null on its side).
  const themeColor = profileStore.themeColor || colors.tint
  const shortName = profileStore.shortName

  const postToWebView = useCallback((message: InjectedMessage) => {
    if (Platform.OS === "web") return
    const payload = JSON.stringify(message).replace(/'/g, "\\'")
    webViewRef.current?.injectJavaScript(`
      window.postMessage('${payload}', '*');
      true;
    `)
  }, [])

  const postAppContext = useCallback(() => {
    postToWebView({
      type: "app_context",
      mode: themeContext,
      themeColor,
      shortName,
    })
  }, [postToWebView, themeContext, themeColor, shortName])

  const injectReplykeToken = useCallback(async () => {
    if (tokenRequestInFlight.current) return
    tokenRequestInFlight.current = true
    try {
      const result = await api.getReplykeToken()
      if (result.kind !== "ok") {
        log.warn("Replyke token fetch failed", { kind: result.kind })
        return
      }
      postToWebView({ type: "replyke_token", token: result.token })
    } catch (error) {
      log.error("Replyke token fetch threw", {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      tokenRequestInFlight.current = false
    }
  }, [postToWebView])

  // Push app_context whenever any of the bundled fields change — only
  // after the web-side listener is ready (the ready handshake performs
  // the initial push, so this effect is for live updates only).
  useEffect(() => {
    if (!isReadyRef.current) return
    postAppContext()
  }, [postAppContext])

  // Re-inject token when auth identity changes (login/logout)
  useEffect(() => {
    if (!isReadyRef.current) return
    injectReplykeToken()
  }, [userIdentifier, injectReplykeToken])

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let parsed: { type?: string; namespace?: string; message?: string } | null = null
      try {
        parsed = JSON.parse(event.nativeEvent.data) as {
          type?: string
          namespace?: string
          message?: string
        }
      } catch {
        return
      }

      switch (parsed?.type) {
        case "replyke_ready": {
          if (isReadyRef.current) return // ignore duplicate ready
          isReadyRef.current = true
          postAppContext()
          injectReplykeToken()
          return
        }
        case "web_debug_log": {
          log.debug("[web]", {
            namespace: parsed.namespace ?? "",
            message: parsed.message ?? "",
          })
          return
        }
        case "replyke_token_request": {
          // On-demand mint: the web side has detected its current Replyke
          // JWT is within ~10s of expiry (or already expired) and asked us
          // to issue a fresh one. Reuses injectReplykeToken's coalescing.
          // No payload — response goes back via the existing
          // { type: "replyke_token", token } message.
          injectReplykeToken()
          return
        }
        default: {
          log.debug("Unknown web message", { type: parsed?.type ?? "" })
        }
      }
    },
    [injectReplykeToken, postAppContext],
  )

  // Reset ready state on navigation (e.g., full reload)
  const handleLoadStart = useCallback(() => {
    isReadyRef.current = false
  }, [])

  const source = useMemo(() => ({ uri: socialUrl }), [socialUrl])

  if (Platform.OS === "web") {
    return (
      <Screen preset="fixed" contentContainerStyle={themed($root)} safeAreaEdges={["top"]}>
        <iframe
          src={socialUrl}
          style={{ border: 0, width: "100%", height: "100%" }}
          title="Social"
        />
      </Screen>
    )
  }

  return (
    <Screen preset="fixed" contentContainerStyle={themed($root)} safeAreaEdges={["top"]}>
      <WebView
        ref={webViewRef}
        source={source}
        onLoadStart={handleLoadStart}
        onMessage={handleMessage}
        onError={(e) => {
          const { description, code } = e.nativeEvent
          log.error("WebView error", { description, code })
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, styles.loader, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.tint} />
          </View>
        )}
        // Belt-and-suspenders for SPA layout drift. The canonical fix is
        // CSS in the Replyke SPA (`overflow-x: hidden`, `overscroll-behavior:
        // contain`, fixed-position bottom nav). These props defend against
        // residual rubber-band overscroll (iOS) and horizontal scroll-spill
        // (Android) so the page can't visibly slide past the viewport even
        // if the SPA regresses or another host renders it without those CSS
        // rules. iOS-only: bounces. Android-only: overScrollMode.
        bounces={false}
        overScrollMode="never"
        directionalLockEnabled
        // Incognito disables the WebView's persistent data store: HTTP cache,
        // cookies, localStorage, service workers. The SPA is session-less by
        // design (Auth0 lives on the RN side; the Replyke JWT is injected
        // fresh per mount), so there's no state to lose. The win: every cold
        // mount fetches a fresh bundle from origin — no risk of a stale HTML
        // shell or a previously-registered service worker pinning the user
        // to an old web build. Cost is bandwidth on each cold mount; the tab
        // is persistent within the session so this only fires on app launch.
        incognito
        style={{ backgroundColor: colors.background }}
      />
    </Screen>
  )
})

const $root: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const styles = StyleSheet.create({
  loader: {
    alignItems: "center",
    justifyContent: "center",
  },
})
