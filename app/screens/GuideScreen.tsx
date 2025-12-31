import { FC, useRef, useEffect, useCallback, useState } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
} from "react-native"
import { useChat } from "@ai-sdk/react"
import { Ionicons } from "@expo/vector-icons"
import { DefaultChatTransport } from "ai"
import { fetch as expoFetch } from "expo/fetch"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useAuthenticationStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { generateApiUrl } from "@/utils/generateApiUrl"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "GuideScreen" })

/**
 * GuideScreen - AI-powered recovery guide and help desk
 *
 * Uses Vercel AI SDK to provide streaming chat with the RecoverySky AI agent.
 * Features:
 * - Streaming responses from Claude
 * - Message history
 * - Tool calls (recovery resources, meeting info, literature)
 */
export const GuideScreen: FC<MainTabScreenProps<"Guide">> = observer(function GuideScreen(_props) {
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()
  const scrollViewRef = useRef<ScrollView>(null)

  // Local state for input (AI SDK v6 manages input internally)
  const [input, setInput] = useState("")

  // Build authorization header
  const getAuthHeaders = useCallback(() => {
    const headers: Record<string, string> = {}
    if (authStore.accessToken) {
      headers["Authorization"] = `Bearer ${authStore.accessToken}`
    }
    return headers
  }, [authStore.accessToken])

  // Initialize chat with Vercel AI SDK
  const { messages, status, error, sendMessage, setMessages } = useChat({
    transport: new DefaultChatTransport({
      fetch: expoFetch as unknown as typeof globalThis.fetch,
      api: generateApiUrl("/api/v1/chat"),
      headers: getAuthHeaders(),
    }),
    onError: (err) => {
      log.error("Chat error", { error: err.message })
    },
  })

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
    sendMessage({ text: message })
  }, [input, setInput, sendMessage])

  const handleClearChat = useCallback(() => {
    setMessages([])
  }, [setMessages])

  const isLoading = status === "streaming" || status === "submitted"

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
      {/* Header */}
      <View style={themed($header)}>
        <View style={$styles.row}>
          <Ionicons name="help-buoy" size={24} color={theme.colors.tint} />
          <Text preset="heading" tx="guideScreen:title" style={themed($headerTitle)} />
        </View>
        {messages.length > 0 && (
          <Pressable onPress={handleClearChat} style={themed($clearButton)}>
            <Ionicons name="trash-outline" size={20} color={theme.colors.textDim} />
          </Pressable>
        )}
      </View>
      <Text style={themed($subtitle)} tx="guideScreen:subtitle" />

      {/* Chat Messages */}
      <KeyboardAvoidingView
        style={themed($chatContainer)}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          ref={scrollViewRef}
          style={themed($messageList)}
          contentContainerStyle={themed($messageListContent)}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={themed($emptyState)}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textDim} />
              <Text style={themed($emptyStateText)} tx="guideScreen:emptyState" />
              <Text style={themed($emptyStateHint)} tx="guideScreen:emptyStateHint" />
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
                  <Text style={themed($messageRole)}>
                    {message.role === "user" ? "You" : "Sky"}
                  </Text>
                </View>
                <View style={themed($messageContent)}>
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <Text key={`${message.id}-${index}`} style={themed($messageText)}>
                          {part.text}
                        </Text>
                      )
                    }
                    // Handle tool calls - show them as informational
                    if (part.type.startsWith("tool-")) {
                      const toolName = part.type.replace("tool-", "")
                      return (
                        <View key={`${message.id}-${index}`} style={themed($toolCall)}>
                          <Ionicons
                            name="construct-outline"
                            size={14}
                            color={theme.colors.textDim}
                          />
                          <Text style={themed($toolCallText)}>Using {toolName}...</Text>
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
              <Text style={themed($loadingText)} tx="guideScreen:thinking" />
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
          <TextField
            value={input}
            onChangeText={setInput}
            placeholderTx="guideScreen:inputPlaceholder"
            style={themed($textInput)}
            inputWrapperStyle={themed($inputWrapper)}
            onSubmitEditing={handleSend}
            editable={!isLoading}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={isLoading || !input.trim()}
            style={[
              themed($sendButton),
              (isLoading || !input.trim()) && themed($sendButtonDisabled),
            ]}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.tint} />
            ) : (
              <Ionicons
                name="send"
                size={20}
                color={input.trim() ? theme.colors.tint : theme.colors.textDim}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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

const $headerTitle: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginLeft: spacing.xs,
})

const $clearButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.xs,
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
  alignItems: "flex-end",
  gap: spacing.sm,
  paddingVertical: spacing.sm,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $textInput: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  minHeight: 40,
  maxHeight: 120,
})

const $inputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderRadius: 20,
  paddingHorizontal: 16,
  paddingVertical: 8,
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
