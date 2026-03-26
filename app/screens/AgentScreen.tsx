import { FC, useRef, useEffect, useCallback, useState, useMemo } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  ScrollView,
  Platform,
  ActivityIndicator,
  Pressable,
  Alert,
  TextInput,
} from "react-native"
import { useChat } from "@ai-sdk/react"
import { Ionicons } from "@expo/vector-icons"
import { DefaultChatTransport } from "ai"
import { fetch as expoFetch } from "expo/fetch"
import { observer } from "mobx-react-lite"

import { ToolResultRenderer } from "@/components/agent"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import { translate, getCurrentLanguage } from "@/i18n"
import {
  useAuthenticationStore,
  useConfigStore,
  useConversationStore,
  useProfileStore,
} from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "AgentScreen" })

/** Strip HTML tags and convert to readable plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * AgentScreen - Sky Agent, your AI-powered recovery meeting agent
 *
 * Uses Vercel AI SDK to provide streaming chat with the RecoverySky AI agent.
 * Features:
 * - Streaming responses from Claude
 * - Message history persisted to encrypted SQLite
 * - Tool calls (recovery resources, meeting info, literature)
 * - Conversation survives app restarts
 */
export const AgentScreen: FC<MainTabScreenProps<"Agent">> = observer(function AgentScreen(props) {
  const { navigation } = props
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const conversationStore = useConversationStore()
  const profileStore = useProfileStore()
  const scrollViewRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)

  // Local state for input (AI SDK v6 manages input internally)
  const [input, setInput] = useState("")

  // State for meeting popup (shown when user taps a meeting from tool results)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)
  const [activeToolCallId, setActiveToolCallId] = useState<string | null>(null)

  // State for FAB menu
  const [fabMenuOpen, setFabMenuOpen] = useState(false)

  // Track which message IDs we've already persisted
  const persistedIdsRef = useRef(new Set<string>())

  // Track previous status to detect streaming completion
  const prevStatusRef = useRef<string>("")

  // Build authorization headers (Bearer token for authenticated, X-API-Key for anonymous)
  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {}
    if (authStore.accessToken) {
      headers["Authorization"] = `Bearer ${authStore.accessToken}`
    } else {
      // Anonymous users get X-API-Key
      if (configStore.authKey) {
        headers["X-API-Key"] = configStore.authKey
      }
    }
    return headers
  }, [authStore.accessToken, configStore.authKey])

  // Initialize useChat with persisted messages from MST store
  const initialMessages = useMemo(() => {
    // Only provide initial messages if store is hydrated
    if (!conversationStore.isHydrated) return undefined

    // Populate persistedIdsRef with already-stored message IDs
    const storedMessages = conversationStore.uiMessages
    storedMessages.forEach((msg) => persistedIdsRef.current.add(msg.id))

    log.debug("Initializing with stored messages", { count: storedMessages.length })
    return storedMessages
  }, [conversationStore.isHydrated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get user's timezone for context-aware responses
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  }, [])

  const agentApiUrl = `${configStore.agentUrl}/api/v1/chat`

  // Initialize chat with Vercel AI SDK
  const { messages, status, error, sendMessage, setMessages } = useChat({
    // Only set initial messages once hydrated
    ...(initialMessages ? { messages: initialMessages } : {}),
    transport: new DefaultChatTransport({
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      api: agentApiUrl,
      headers: getAuthHeaders(),
      body: { timezone, fellowship: profileStore.fellowship },
    }),
    onError: (err) => {
      log.error("Chat error", { error: err.message, url: agentApiUrl })
    },
  })

  // Effect: Persist new messages when streaming completes
  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = status

    // Only act when transitioning from streaming/submitted to ready
    const streamingCompleted =
      (prevStatus === "streaming" || prevStatus === "submitted") && status === "ready"

    if (!streamingCompleted) return

    // Find messages that haven't been persisted yet
    const newMessages = messages.filter((msg) => !persistedIdsRef.current.has(msg.id))

    if (newMessages.length === 0) return

    log.info("Streaming complete, persisting new messages", {
      count: newMessages.length,
      ids: newMessages.map((m) => m.id.slice(0, 8)).join(","),
    })

    // Mark as persisted immediately to prevent duplicates
    newMessages.forEach((msg) => persistedIdsRef.current.add(msg.id))

    // Add to store (which persists to SQLite)
    newMessages.forEach((msg) => {
      conversationStore.addMessage(msg)
    })
  }, [status, messages, conversationStore])

  // Effect: Restore messages to useChat when store hydrates
  useEffect(() => {
    if (conversationStore.isHydrated && conversationStore.hasMessages) {
      const storedMessages = conversationStore.uiMessages

      // Only set if useChat doesn't have messages yet
      if (messages.length === 0 && storedMessages.length > 0) {
        log.info("Restoring messages from store", { count: storedMessages.length })
        storedMessages.forEach((msg) => persistedIdsRef.current.add(msg.id))
        setMessages(storedMessages)
      }
    }
  }, [conversationStore.isHydrated, conversationStore.hasMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    const message = input.trim()
    setInput("")
    trackEvent("agent_message_sent")
    sendMessage({ text: message })
  }, [input, setInput, sendMessage])

  const doClearChat = useCallback(() => {
    // Clear useChat state
    setMessages([])
    // Clear persisted IDs tracker
    persistedIdsRef.current.clear()
    // Clear store (and SQLite)
    conversationStore.clearHistory()
  }, [setMessages, conversationStore])

  const handleClearChat = useCallback(() => {
    Alert.alert(
      translate("agentScreen:clearConversation"),
      translate("agentScreen:clearConversationConfirm"),
      [
        { text: translate("agentScreen:cancel"), style: "cancel" },
        { text: translate("agentScreen:clear"), style: "destructive", onPress: doClearChat },
      ],
    )
  }, [doClearChat])

  // Handle meeting selection from tool results
  const handleSelectMeeting = useCallback((meeting: MeetingWithTrex, toolCallId: string) => {
    setSelectedMeeting(meeting)
    setActiveToolCallId(toolCallId)
  }, [])

  // Handle popup close - collapse the tool result
  const handleClosePopup = useCallback(() => {
    if (selectedMeeting && activeToolCallId) {
      conversationStore.collapseToolResult(
        activeToolCallId,
        translate("agentScreen:selected", { name: selectedMeeting.name }),
      )
    }
    setSelectedMeeting(null)
    setActiveToolCallId(null)
  }, [selectedMeeting, activeToolCallId, conversationStore])

  const isLoading = status === "streaming" || status === "submitted"

  // Voice input - language derived from current app locale
  const voiceLanguage = getCurrentLanguage() === "es" ? "es-MX" : "en-US"
  const {
    state: voiceState,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoiceInput((transcript) => setInput(transcript), voiceLanguage)
  const isVoiceActive = voiceState !== "idle"

  // Extract debug metadata from last assistant message
  const debugMetadata = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
    if (!lastAssistant?.metadata) return null

    const meta = lastAssistant.metadata as {
      crisisLevel?: number
      tokensUsed?: { input: number; output: number; total: number }
      emergency?: boolean
    }

    if (!meta.tokensUsed) return null
    return meta
  }, [messages])

  // Fetch AI consent text from CMS
  const [consentContent, setConsentContent] = useState("")
  useEffect(() => {
    if (profileStore.aiConsentAccepted) return
    api
      .getContent("aiConsent")
      .then((result) => {
        if (result.kind === "ok") setConsentContent(htmlToText(result.content))
      })
      .catch(() => {})
  }, [profileStore.aiConsentAccepted])

  // AI consent gate (Apple Guideline 5.1.2(i))
  // Must be after all hooks to avoid "Rendered more hooks" error
  if (!profileStore.aiConsentAccepted) {
    return (
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
        <View style={themed($header)}>
          <View style={$styles.row}>
            <Ionicons name="help-buoy" size={24} color={theme.colors.tint} />
            <Text preset="heading" tx="agentScreen:title" style={themed($headerTitle)} />
          </View>
        </View>
        <Text style={themed($subtitle)} tx="agentScreen:subtitle" />

        <ScrollView style={themed($consentScroll)} showsVerticalScrollIndicator={false}>
          <View style={themed($consentHeader)}>
            <Ionicons name="shield-checkmark" size={32} color={theme.colors.tint} />
            <Text preset="subheading" tx="agentScreen:consentTitle" style={themed($consentTitle)} />
          </View>
          <Text style={themed($consentText)}>{consentContent}</Text>
        </ScrollView>

        <View style={themed($consentFooter)}>
          <Pressable
            onPress={() => profileStore.setAiConsentAccepted(true)}
            style={themed($consentAcceptButton)}
            accessibilityRole="button"
            accessibilityLabel={translate("agentScreen:consentAccept")}
          >
            <Text preset="bold" tx="agentScreen:consentAccept" style={$consentAcceptText} />
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            style={themed($consentDeclineButton)}
            accessibilityRole="button"
            accessibilityLabel={translate("agentScreen:consentDecline")}
          >
            <Text tx="agentScreen:consentDecline" style={themed($consentDeclineText)} />
          </Pressable>
        </View>
      </Screen>
    )
  }

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
      {/* Debug Overlay */}
      {debugMetadata && (
        <View style={themed($debugOverlay)}>
          {debugMetadata.emergency && (
            <Ionicons name="warning" size={14} color="#ef4444" style={{ marginRight: 4 }} />
          )}
          <Text style={themed($debugText)}>L{debugMetadata.crisisLevel ?? 0}</Text>
          <Text style={themed($debugSeparator)}>|</Text>
          <Text style={themed($debugText)}>
            ctx: {(debugMetadata.tokensUsed?.input ?? 0).toLocaleString()}
          </Text>
          <Text style={themed($debugSeparator)}>|</Text>
          <Text style={themed($debugText)}>
            out: {(debugMetadata.tokensUsed?.output ?? 0).toLocaleString()}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={themed($header)}>
        <View style={$styles.row}>
          <Ionicons name="help-buoy" size={24} color={theme.colors.tint} />
          <Text preset="heading" tx="agentScreen:title" style={themed($headerTitle)} />
        </View>
      </View>
      <Text style={themed($subtitle)} tx="agentScreen:subtitle" />

      {/* Chat Messages */}
      <View style={themed($chatContainer)}>
        <ScrollView
          ref={scrollViewRef}
          style={themed($messageList)}
          contentContainerStyle={themed($messageListContent)}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={themed($emptyState)}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textDim} />
              <Text style={themed($emptyStateText)} tx="agentScreen:emptyState" />
              <Text style={themed($emptyStateHint)} tx="agentScreen:emptyStateHint" />
            </View>
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                style={[
                  themed($messageBubble),
                  message.role === "user" ? themed($userBubble) : themed($assistantBubble),
                ]}
              >
                <View style={themed($messageHeader)}>
                  <Ionicons
                    name={message.role === "user" ? "person-circle" : "sparkles"}
                    size={16}
                    color={message.role === "user" ? theme.colors.tint : "#9C27B0"}
                  />
                  <Text style={[themed($messageRole), message.role === "user" && $userMessageRole]}>
                    {message.role === "user"
                      ? translate("agentScreen:roleYou")
                      : translate("agentScreen:roleSky")}
                  </Text>
                </View>
                <View style={themed($messageContent)}>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <Text
                          key={`${message.id}-${index}`}
                          style={[
                            themed($messageText),
                            message.role === "user" && $userMessageText,
                          ]}
                        >
                          {part.text}
                        </Text>
                      )
                    }

                    // Handle tool parts (both static and dynamic)
                    // Static: type = "tool-{toolName}"
                    // Dynamic: type = "dynamic-tool" with toolName field
                    const isStaticTool = part.type.startsWith("tool-")
                    const isDynamicTool = part.type === "dynamic-tool"

                    if (isStaticTool || isDynamicTool) {
                      const toolPart = part as unknown as {
                        type: string
                        toolCallId: string
                        toolName?: string
                        state?: string
                        input?: unknown
                        output?: unknown
                      }

                      // Extract tool name
                      const toolName = isDynamicTool
                        ? (toolPart.toolName ?? "tool")
                        : part.type.replace("tool-", "")

                      // Check if output is available (tool completed)
                      const hasOutput = toolPart.state === "output-available" && toolPart.output

                      if (hasOutput) {
                        // Render completed tool results with interactive UI
                        return (
                          <ToolResultRenderer
                            key={`${message.id}-${index}`}
                            part={{
                              type: "tool-result",
                              toolCallId: toolPart.toolCallId,
                              toolName,
                              result: toolPart.output,
                            }}
                            messageId={message.id}
                            onSelectMeeting={handleSelectMeeting}
                          />
                        )
                      }

                      // Tool still in progress - show loading badge
                      return (
                        <View key={`${message.id}-${index}`} style={themed($toolCall)}>
                          <Ionicons
                            name="construct-outline"
                            size={14}
                            color={theme.colors.textDim}
                          />
                          <Text style={themed($toolCallText)}>
                            {translate("agentScreen:usingTool", { toolName })}
                          </Text>
                        </View>
                      )
                    }

                    return null
                  })}
                </View>
              </View>
            ))
          )}

          {/* Loading indicator */}
          {isLoading && (
            <View style={themed($loadingContainer)}>
              <ActivityIndicator size="small" color={theme.colors.tint} />
              <Text style={themed($loadingText)} tx="agentScreen:thinking" />
            </View>
          )}

          {/* Error display */}
          {error && (
            <View style={themed($errorContainer)}>
              <Ionicons name="warning" size={16} color={theme.colors.error} />
              <Text style={themed($errorText)}>{error.message}</Text>
            </View>
          )}
        </ScrollView>

        {/* Input Area */}
        <View style={themed($inputContainer)}>
          {/* Mic button */}
          <Pressable
            onPress={voiceState === "recording" ? stopRecording : startRecording}
            disabled={isLoading || voiceState === "processing"}
            style={[themed($micButton), voiceState === "recording" && themed($micButtonRecording)]}
            accessibilityRole="button"
            accessibilityLabel={translate(
              voiceState === "recording"
                ? "agentScreen:stopRecording"
                : "agentScreen:startVoiceInput",
            )}
          >
            {voiceState === "processing" ? (
              <ActivityIndicator size="small" color={theme.colors.tint} />
            ) : (
              <Ionicons
                name={voiceState === "recording" ? "stop" : "mic"}
                size={20}
                color={voiceState === "recording" ? theme.colors.error : theme.colors.textDim}
              />
            )}
          </Pressable>

          <TextField
            ref={inputRef}
            value={voiceState === "processing" ? translate("agentScreen:transcribing") : input}
            onChangeText={setInput}
            placeholderTx="agentScreen:inputPlaceholder"
            containerStyle={$inputContainerInner}
            style={themed($textInput)}
            inputWrapperStyle={themed($inputWrapper)}
            onSubmitEditing={handleSend}
            editable={!isLoading && !isVoiceActive}
            returnKeyType="send"
            blurOnSubmit={true}
          />
          <Pressable
            onPress={handleSend}
            disabled={isLoading || isVoiceActive || !input.trim()}
            style={[
              themed($sendButton),
              (isLoading || isVoiceActive || !input.trim()) && themed($sendButtonDisabled),
            ]}
            accessibilityRole="button"
            accessibilityLabel={translate("agentScreen:sendMessage")}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.tint} />
            ) : (
              <Ionicons
                name="send"
                size={20}
                color={input.trim() && !isVoiceActive ? theme.colors.tint : theme.colors.textDim}
              />
            )}
          </Pressable>
        </View>

        {/* Voice error message */}
        {voiceError && (
          <View style={themed($voiceErrorContainer)}>
            <Ionicons name="warning-outline" size={14} color={theme.colors.error} />
            <Text style={themed($voiceErrorText)}>
              {translate(`agentScreen:${voiceError}` as Parameters<typeof translate>[0])}
            </Text>
          </View>
        )}
      </View>

      {/* Floating Action Menu */}
      {messages.length > 0 && !isLoading && (
        <View style={themed($fabContainer)}>
          {/* Menu Items (shown when open) */}
          {fabMenuOpen && (
            <View style={themed($fabMenu)}>
              <Pressable
                onPress={() => {
                  setFabMenuOpen(false)
                  handleClearChat()
                }}
                style={themed($fabMenuItem)}
                accessibilityRole="button"
                accessibilityLabel={translate("agentScreen:clearChat")}
              >
                <Ionicons name="trash-outline" size={18} color="#FFF" />
              </Pressable>
            </View>
          )}

          {/* FAB Toggle */}
          <Pressable
            onPress={() => setFabMenuOpen(!fabMenuOpen)}
            style={[themed($fab), fabMenuOpen && themed($fabOpen)]}
            accessibilityRole="button"
            accessibilityLabel={
              fabMenuOpen ? translate("common:close") : translate("agentScreen:openMenu")
            }
          >
            <Ionicons name={fabMenuOpen ? "close" : "ellipsis-vertical"} size={20} color="#FFF" />
          </Pressable>
        </View>
      )}

      {/* Meeting Detail Popup - shown when user taps a meeting from tool results */}
      <SchedulePopup
        visible={selectedMeeting !== null}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />
    </Screen>
  )
})

// Styles
const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.md,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: spacing.sm,
})

const $debugOverlay: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  position: "absolute",
  top: spacing.xs,
  right: spacing.md,
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: colors.background + "E6",
  paddingHorizontal: spacing.xs,
  paddingVertical: 2,
  borderRadius: 4,
  borderWidth: 1,
  borderColor: colors.border,
  zIndex: 100,
})

const $debugText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 10,
  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  color: colors.textDim,
})

const $debugSeparator: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 10,
  color: colors.border,
  marginHorizontal: 4,
})

const $headerTitle: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginLeft: spacing.xs,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  marginTop: spacing.xs,
  marginBottom: spacing.md,
})

const $chatContainer: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $messageList: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $messageListContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.md,
})

const $emptyState: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyStateText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.text,
  fontSize: 16,
  fontWeight: "600",
  marginTop: spacing.md,
  textAlign: "center",
})

const $emptyStateHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  fontSize: 14,
  marginTop: spacing.xs,
  textAlign: "center",
  paddingHorizontal: spacing.xl,
})

const $messageBubble: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginVertical: spacing.xs,
  padding: spacing.sm,
  borderRadius: 12,
  maxWidth: "90%",
})

const $userBubble: ThemedStyle<ViewStyle> = ({ colors }) => ({
  alignSelf: "flex-end",
  backgroundColor: "#000",
  borderWidth: 1,
  borderColor: colors.tint + "40",
  borderBottomRightRadius: 4,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  elevation: 4,
})

const $assistantBubble: ThemedStyle<ViewStyle> = ({ colors }) => ({
  alignSelf: "flex-start",
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderBottomLeftRadius: 4,
})

const $messageHeader: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  marginBottom: spacing.xs,
  gap: spacing.xs,
})

const $messageRole: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  fontWeight: "600",
  color: colors.textDim,
})

// User message styles - light text on dark background
const $userMessageRole: TextStyle = {
  color: "rgba(255, 255, 255, 0.7)",
}

const $userMessageText: TextStyle = {
  color: "#FFFFFF",
}

const $messageContent: ThemedStyle<ViewStyle> = () => ({})

const $messageText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontSize: 15,
  lineHeight: 22,
})

const $toolCall: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginTop: spacing.xs,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  backgroundColor: colors.background,
  borderRadius: 8,
})

const $toolCallText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  fontStyle: "italic",
})

const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  alignSelf: "flex-start",
  gap: spacing.xs,
  padding: spacing.sm,
})

const $loadingText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
  fontStyle: "italic",
})

const $errorContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  padding: spacing.sm,
  backgroundColor: colors.error + "20",
  borderRadius: 8,
  marginTop: spacing.sm,
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.error,
  flex: 1,
})

const $inputContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingTop: spacing.sm,
  paddingBottom: spacing.lg,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $inputContainerInner: ViewStyle = {
  flex: 1,
}

const $textInput: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  color: colors.text,
})

const $inputWrapper: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: 22,
  paddingHorizontal: spacing.md,
  justifyContent: "center",
  height: 44,
})

const $sendButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  alignItems: "center",
  justifyContent: "center",
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $sendButtonDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderColor: colors.border,
  shadowOpacity: 0,
  elevation: 0,
})

const $fabContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  position: "absolute",
  top: spacing.lg,
  right: spacing.md,
  alignItems: "center",
})

const $fabMenu: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.xs,
})

const $fabMenuItem: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: colors.error,
  alignItems: "center",
  justifyContent: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 6,
})

const $fab: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: colors.tint,
  alignItems: "center",
  justifyContent: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 6,
})

const $fabOpen: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.textDim,
})

const $micButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center",
  justifyContent: "center",
})

const $micButtonRecording: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderColor: colors.error,
  borderWidth: 2,
})

const $voiceErrorContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingHorizontal: spacing.sm,
  paddingBottom: spacing.xs,
})

const $voiceErrorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.error,
  flex: 1,
})

// Consent gate styles
const $consentScroll: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $consentHeader: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  gap: spacing.sm,
  marginVertical: spacing.lg,
})

const $consentTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
})

const $consentText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  fontSize: 14,
  lineHeight: 22,
  paddingHorizontal: spacing.xs,
})

const $consentFooter: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.md,
  gap: spacing.sm,
  borderTopWidth: 1,
  borderTopColor: "rgba(255,255,255,0.1)",
})

const $consentAcceptButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.tint,
  paddingVertical: spacing.sm,
  borderRadius: 12,
  alignItems: "center",
})

const $consentAcceptText: TextStyle = {
  color: "#000",
  fontSize: 16,
}

const $consentDeclineButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  alignItems: "center",
})

const $consentDeclineText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
})
