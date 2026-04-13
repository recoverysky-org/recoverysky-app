/**
 * SocialScreen
 *
 * In-app browser window to the Replyke-hosted RecoverySky social site.
 * The native shell owns identity (Auth0 on RN side) and injects a pre-signed
 * Replyke JWT into the WebView; Auth0 never enters the WebView.
 *
 * Messages posted into the WebView:
 *   - { type: "replyke_token", token } — signed Replyke JWT for ReplykeProvider
 *   - { type: "theme", theme: "dark" | "light" } — theme sync
 *
 * Handshake: the web app must post `{ type: "replyke_ready" }` back via
 * window.ReactNativeWebView.postMessage once its message listener is
 * attached. RN injects the token + theme in response, avoiding a race
 * where messages posted at onLoadEnd are dropped before React has
 * committed and effects have flushed.
 */

import { FC, useCallback, useEffect, useMemo, useRef } from "react"
import { ActivityIndicator, Platform, StyleSheet, View, ViewStyle } from "react-native"
import { useIsFocused } from "@react-navigation/native"
import { observer } from "mobx-react-lite"
import WebView, { type WebViewMessageEvent } from "react-native-webview"

import { Screen } from "@/components/Screen"
import { useAuthenticationStore, useConfigStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "SocialScreen" })

type InjectedMessage =
  | { type: "replyke_token"; token: string }
  | { type: "theme"; theme: "dark" | "light" }

export const SocialScreen: FC<MainTabScreenProps<"Social">> = observer(function SocialScreen() {
  const {
    themed,
    theme: { colors },
    themeContext,
  } = useAppTheme()
  const configStore = useConfigStore()
  const authStore = useAuthenticationStore()
  const webViewRef = useRef<WebView>(null)
  const isReadyRef = useRef(false)
  const isFocused = useIsFocused()

  const socialUrl = configStore.socialUrl
  const userIdentifier = authStore.userIdentifier

  const postToWebView = useCallback((message: InjectedMessage) => {
    if (Platform.OS === "web") return
    const payload = JSON.stringify(message).replace(/'/g, "\\'")
    webViewRef.current?.injectJavaScript(`
      window.postMessage('${payload}', '*');
      true;
    `)
  }, [])

  const injectReplykeToken = useCallback(async () => {
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
    }
  }, [postToWebView])

  // Sync theme whenever it changes — only after the web-side listener is ready
  useEffect(() => {
    if (!isReadyRef.current) return
    postToWebView({ type: "theme", theme: themeContext })
  }, [themeContext, postToWebView])

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
          postToWebView({ type: "theme", theme: themeContext })
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
        default: {
          log.debug("Unknown web message", { type: parsed?.type ?? "" })
        }
      }
    },
    [injectReplykeToken, postToWebView, themeContext],
  )

  // Reset ready state on navigation (e.g., full reload)
  const handleLoadStart = useCallback(() => {
    isReadyRef.current = false
  }, [])

  const source = useMemo(() => ({ uri: socialUrl }), [socialUrl])

  // Unmount the embed whenever the tab is not focused — this forces a
  // fresh reload (and re-handshake) on every navigation back to Social.
  if (!isFocused) {
    return <Screen preset="fixed" contentContainerStyle={themed($root)} safeAreaEdges={["top"]} />
  }

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
