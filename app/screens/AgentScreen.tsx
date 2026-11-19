import {
  Dispatch,
  FC,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  ScrollView,
  Platform,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native"
import { useChat } from "@ai-sdk/react"
import { Ionicons } from "@expo/vector-icons"
import { useNavigationState } from "@react-navigation/native"
import { DefaultChatTransport, type UIMessage } from "ai"
import { fetch as expoFetch } from "expo/fetch"
import { observer } from "mobx-react-lite"

import { ToolResultRenderer } from "@/components/agent"
import { InPersonPopup } from "@/components/InPersonPopup"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useSubscription } from "@/context/SubscriptionContext"
import { feedbackCache } from "@/db"
import { useAgentConversation, type AgentChatState } from "@/hooks/useAgentConversation"
import { useSkyMeetingPopup } from "@/hooks/useSkyMeetingPopup"
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
import {
  chatErrorLogFields,
  chatRequestBody,
  favoriteMeetingIds,
  isStaleRefusal,
  turnOf,
} from "@/utils/agentBodyLogic"
import { classifyToolPart } from "@/utils/agentToolPartLogic"
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
 * The text of a message part, or null. Parts read back from the agent are checked only for being an
 * array (`isStoredMessage`), so one can be `null` or a text part with no string in it, whatever the
 * SDK's type says. A throw in the render path would take the whole tab down over one bad row, and a
 * non-string child makes RN's Text throw.
 */
function textOfPart(part: unknown): string | null {
  if (typeof part !== "object" || part === null) return null
  const { type, text } = part as { type?: unknown; text?: unknown }
  return type === "text" && typeof text === "string" ? text : null
}

/** The words of the last message the person sent, from its text parts. Empty when there are none. */
function lastUserWords(messages: readonly UIMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user")
  if (!last) return ""
  return last.parts
    .map(textOfPart)
    .filter((text) => text !== null)
    .join("")
}

/** The title and subtitle, the same over every state of the tab. */
const AgentHeader: FC = () => {
  const { themed, theme } = useAppTheme()
  return (
    <>
      <View style={themed($header)}>
        <View style={$styles.row}>
          <Ionicons name="help-buoy" size={24} color={theme.colors.tint} />
          <Text preset="heading" tx="agentScreen:title" style={themed($headerTitle)} />
        </View>
      </View>
      <Text style={themed($subtitle)} tx="agentScreen:subtitle" />
    </>
  )
}

/** "Couldn't load your conversation" with its retry, for a failed listing or a failed history. */
const LoadFailedRow: FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { themed, theme } = useAppTheme()
  return (
    <View style={themed($errorContainer)}>
      <Ionicons name="warning" size={16} color={theme.colors.error} />
      <Text style={themed($errorText)} tx="agentScreen:loadFailed" />
      <Pressable
        onPress={onRetry}
        style={themed($retryButton)}
        accessibilityRole="button"
        accessibilityLabel={translate("agentScreen:retry")}
      >
        <Text preset="bold" style={themed($retryText)} tx="agentScreen:retry" />
      </Pressable>
    </View>
  )
}

/**
 * AgentScreen - Sky Agent, your AI-powered recovery meeting agent
 *
 * Uses Vercel AI SDK to provide streaming chat with the RecoverySky AI agent.
 * Features:
 * - Streaming responses from Claude
 * - Tool calls (recovery resources, meeting info, literature)
 *
 * CHANGED 2026-11-06 (spec 2026-11-06-agent-chat-turn-only-design.md): the thread lives on the agent,
 * not in encrypted SQLite, and each request carries only the turn. This outer shell holds what must
 * outlive a conversation: the consent gate and the composer's words. `AgentChat` is keyed by the
 * conversation id and remounts on a new thread, or when the stale path shows `loading` in its place,
 * so words held in there would be lost at the moment the stale path has just put them back.
 */
export const AgentScreen: FC<MainTabScreenProps<"Agent">> = observer(function AgentScreen(props) {
  const { navigation } = props
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const profileStore = useProfileStore()

  // Local state for input (AI SDK v6 manages input internally)
  const [input, setInput] = useState("")

  // ADDED 2026-11-08 (routine card): the routine card's "Open My Day" link, only while the tab
  // navigator holds a My Day tab. Read from the navigator's own routes rather than re-deciding
  // `decideMyDayTabVisible`, so the link follows the tab's gate exactly (the `myday` entitlement
  // landing after a cold start included). Without the tab, the card shows with no link.
  // CHANGED 2026-11-19: the tab now shows without the entitlement (an upsell), so the route alone
  // no longer means the account has My Day; the link also needs `hasMyDay`. Without it a tap
  // would land on the tab's locked page.
  const { hasMyDay } = useSubscription()
  const myDayRouteExists = useNavigationState(
    (state) => state?.routeNames?.includes("MyDay") ?? false,
  )
  const myDayTabShown = myDayRouteExists && hasMyDay
  // The tab itself, as a tab press would: My Day keeps the person's place. Naming `MyDayToday`
  // pushed a second Today onto the stack whenever another My Day screen was on top (React
  // Navigation 7's navigate reuses only the current route), and `pop: true` would drop an open
  // editor's draft. A tab never opened yet starts on Today, its initial route. (review 2026-11-08)
  const openMyDay = useCallback(() => navigation.navigate("MyDay"), [navigation])
  const onOpenMyDay = myDayTabShown ? openMyDay : undefined

  // Spec D1: no read before consent, and none without a session.
  const { view, chatState, retry, reopenStale, startNew } = useAgentConversation({
    agentUrl: configStore.agentUrl,
    enabled: authStore.isAuthenticated && profileStore.aiConsentAccepted,
  })

  // Fetch AI consent text from CMS
  const [consentContent, setConsentContent] = useState("")
  useEffect(() => {
    if (profileStore.aiConsentAccepted) return
    api
      .getContent("AI_Consent")
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
        <AgentHeader />

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

  if (view.phase === "ready") {
    return (
      <AgentChat
        key={view.id}
        conversationId={view.id}
        history={view.history}
        historyFailed={view.historyFailed}
        readAt={view.readAt}
        chatState={chatState}
        input={input}
        setInput={setInput}
        onRetry={retry}
        onStale={reopenStale}
        onStartNew={startNew}
        onOpenMyDay={onOpenMyDay}
      />
    )
  }

  // Loading, or a listing that failed over nothing. No composer in either: the chat needs the agent
  // anyway, and minting an id now would fork the thread (spec D1). Any words stay in `input`.
  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
      <AgentHeader />
      {view.phase === "loading" ? (
        <View
          style={themed($loadingPhase)}
          accessible
          accessibilityLabel={translate("common:loading")}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator size="small" color={theme.colors.tint} />
        </View>
      ) : (
        <LoadFailedRow onRetry={retry} />
      )}
    </Screen>
  )
})

interface AgentChatProps {
  conversationId: string
  /** Handed to useChat for the mount. Later reads arrive through `readAt`. */
  history: UIMessage[]
  historyFailed: boolean
  /** Changes when `history` is what the mounted chat should now show. */
  readAt: number
  chatState: MutableRefObject<AgentChatState>
  input: string
  setInput: Dispatch<SetStateAction<string>>
  onRetry: () => void
  /** The thread in memory is stale: the outer shell reads it again, which unmounts this chat. */
  onStale: () => void
  onStartNew: () => void
  /** Opens the My Day tab from a routine card; undefined when there is no My Day tab */
  onOpenMyDay?: () => void
}

/**
 * One conversation's chat. The screen's body before the split, minus the store sync.
 *
 * An observer because it reads `profileStore.fellowship`, and a change there must reach
 * `fellowshipRef` below.
 */
const AgentChat: FC<AgentChatProps> = observer(function AgentChat({
  conversationId,
  history,
  historyFailed,
  readAt,
  chatState,
  input,
  setInput,
  onRetry,
  onStale,
  onStartNew,
  onOpenMyDay,
}) {
  const { themed, theme } = useAppTheme()
  const configStore = useConfigStore()
  const conversationStore = useConversationStore()
  const profileStore = useProfileStore()
  const scrollViewRef = useRef<ScrollView>(null)

  // State for meeting popup (shown when user taps a meeting from tool results)
  // CHANGED 2026-11-08: the hook looks the tapped meeting's schedule up by id. A card's meeting is
  // meetings-mcp's Meeting, and this state used to hold it cast to `MeetingWithTrex`, a shape no
  // tool sent, so the popup had no schedule to join or remind from.
  const { popup, openMeeting, closePopup } = useSkyMeetingPopup()

  // State for FAB menu
  const [fabMenuOpen, setFabMenuOpen] = useState(false)

  // Get user's timezone for context-aware responses
  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  }, [])

  const agentApiUrl = `${configStore.agentUrl}/api/v1/chat`

  // Updated each render and read at send time, so the transport below, built once, sends the
  // fellowship of the moment and not the mount's after a change in Settings.
  const fellowshipRef = useRef(profileStore.fellowship)
  fellowshipRef.current = profileStore.fellowship

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        fetch: expoFetch as unknown as typeof globalThis.fetch,
        api: agentApiUrl,
        // Resolved per request: the device JWT and the bearer rotate (see
        // api.agentHeaders)
        headers: () => api.agentHeaders(),
        // The body is the turn (spec D2): the agent holds the history and builds the context.
        prepareSendMessagesRequest: ({ id, messages }) => {
          // Recorded just before the request goes out, so a turn that fails on the way still counts
          // as sent. Its id missing from the agent's stored messages is the whole signal that it
          // exists only on this screen, and that a re-read must not replace it (spec D1). An
          // answered card is not the person's words and has no id of theirs to check.
          // CHANGED 2026-11-06 (final review): this used to read as if nothing could fail ahead of
          // it. The SDK awaits `headers` above before it calls this, so a turn that fails there
          // never gets here. The error effect below records that one.
          const turn = turnOf(messages)
          if (turn?.role === "user") chatState.current.sentIds.add(turn.id)
          // ADDED 2026-11-08 (agent spec 2026-11-07-sky-on-meetings-mcp-design.md): the hearted
          // meetings, so meetings-mcp marks them and lists them first. Read from the cache at send
          // time, like the fellowship above, so a heart tapped since the last turn counts. The
          // cache answers nothing before it has loaded and while guest mode suppresses it, and
          // that turn goes without favorites. The ids go in the body only: never log them.
          const favorites = favoriteMeetingIds(feedbackCache.getAll().values())
          return {
            body: chatRequestBody(id, messages, timezone, fellowshipRef.current, favorites),
          }
        },
      }),
    [agentApiUrl, chatState, timezone],
  )

  // ADDED 2026-11-06 (final review): only while the store is still on this chat's thread. A stream
  // can outlive a sign-out (useChat does not abort on unmount), and marking then would clear the
  // flag of an id minted since, which would then read an id the agent has never seen.
  const markOnAgent = useCallback(() => {
    if (conversationStore.conversationId === conversationId) {
      conversationStore.markConversationOnAgent()
    }
  }, [conversationStore, conversationId])

  // Initialize chat with Vercel AI SDK
  const { messages, status, error, sendMessage, setMessages, clearError } = useChat({
    id: conversationId,
    messages: history,
    transport,
    onError: (err) => {
      // CHANGED 2026-11-06 (final review): a stale refusal is the agent working as designed, and the
      // error effect below handles it, so it logs at info and stays out of the error counts. And no
      // line logs `err.message` any more: it is the raw response body, which can carry what the
      // person said (see chatErrorLogFields).
      const detail = { ...chatErrorLogFields(err), url: agentApiUrl }
      if (isStaleRefusal(err.message)) log.info("Chat turn refused as stale", detail)
      else log.error("Chat error", detail)
    },
    // The second half of marking the id, with the effect below. A short reply can arrive in one
    // read, and React may never commit the passing "streaming" status, so the effect would not see
    // it. The id would stay fresh, and fresh reads nothing, so this thread would come back empty
    // after a restart. A reply with parts means the agent admitted the turn; a turn refused before
    // streaming finishes with none, and stays fresh (spec D1).
    // The SDK also fires this on a failed request, with `isError: true` and empty parts, which is
    // why the parts check exists. `!isError` would be the wrong test: a stream that fails midway has
    // `isError` too, its parts are there, and the agent has already stored the turn.
    onFinish: ({ message }) => {
      if (message.parts.length > 0) markOnAgent()
    },
  })

  const isLoading = status === "streaming" || status === "submitted"

  // The hook runs no open during a turn and drops a read that lands in one. Declared ahead of the
  // error effect so busy is already down when a stale refusal asks for the re-read.
  useEffect(() => {
    chatState.current.busy = isLoading
  }, [isLoading, chatState])

  // An unmounted chat has no turn on screen to protect, and busy left set would skip every open.
  useEffect(
    () => () => {
      chatState.current.busy = false
    },
    [chatState],
  )

  // Streaming means the agent has stored the person's message (agent R2), so the id can be read from
  // now on. A turn that fails before this leaves the id fresh, and nothing is read (spec D1). Not
  // left to onFinish alone: the app can be killed mid-reply, and the flag persists.
  useEffect(() => {
    if (status === "streaming") markOnAgent()
  }, [status, markOnAgent])

  // A re-read of this conversation landed. A new conversation never comes through here: its id is a
  // new key, and its history arrives as the mount's `messages`. So this skips the mount's readAt. It
  // also records a readAt it skips: that read predates the turn running, and showing it when the
  // turn ends would erase the turn.
  const appliedReadAt = useRef(readAt)
  useEffect(() => {
    if (appliedReadAt.current === readAt) return
    appliedReadAt.current = readAt
    // CHANGED 2026-11-06 (final review): clears the error too. A row about a turn left on screen
    // would outlive the list it was about, and the agent holds that turn or this read wouldn't land.
    if (!isLoading) {
      setMessages(history)
      clearError()
    }
  }, [readAt, history, isLoading, setMessages, clearError])

  const isStale = error ? isStaleRefusal(error.message) : false

  // Spec D8: the thread in memory is stale and a retry would repeat the refusal. The re-read replaces
  // the list the person's words are in, so they go back in the composer first.
  //
  // Keyed on `error` alone so one refusal acts once: `messages` and `input` move on every render, and
  // a second run would put the words back a second time.
  useEffect(() => {
    if (!error) return

    // ADDED 2026-11-06 (final review): any other failure leaves the turn in the list, and a re-read
    // must not replace it. The transport records the id, but only once the SDK has the headers, so
    // a failure there (no token, say) would leave these words open to the next focus. Harmless when
    // the transport did get there: it is a set.
    if (!isStale) {
      const turn = turnOf(messages)
      if (turn?.role === "user") chatState.current.sentIds.add(turn.id)
      return
    }

    const words = lastUserWords(messages)
    // Anything typed since the send stays, after the returned words. Overwriting it would lose words
    // to the very path that exists to save them.
    if (words) setInput((typed) => (typed ? `${words} ${typed}` : words))
    clearError()
    onStale()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  // Auto-scroll to bottom when new messages arrive
  // CHANGED 2026-11-06 (final review): only for a new last message or a turn in progress. Bottom tabs
  // stay mounted and every focus re-reads, so scrolling on any new array moved someone reading back
  // to the end at each tab switch. The turn matters because a growing reply keeps its id, and its
  // last chunk can land in the commit that ends the turn, hence the falling edge as well. A re-read
  // never lands during a turn (the read effect above), so this can't catch one.
  const scrolledToId = useRef<string | undefined>(undefined)
  const turnWasRunning = useRef(false)
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id
    const follow = lastId !== scrolledToId.current || isLoading || turnWasRunning.current
    scrolledToId.current = lastId
    turnWasRunning.current = isLoading
    if (lastId !== undefined && follow) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages, isLoading])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    const message = input.trim()
    setInput("")
    trackEvent("agent_message_sent")
    sendMessage({ text: message })
  }, [input, setInput, sendMessage])

  // CHANGED 2026-11-06 (spec D6): was Clear conversation. Nothing is lost now (the old thread is
  // archived on the agent, not erased), so the action is no longer styled destructive.
  const handleNewConversation = useCallback(() => {
    Alert.alert(
      translate("agentScreen:newConversation"),
      translate("agentScreen:newConversationConfirm"),
      [
        { text: translate("agentScreen:cancel"), style: "cancel" },
        { text: translate("agentScreen:start"), onPress: onStartNew },
      ],
    )
  }, [onStartNew])

  // Handle meeting selection from tool results: the popup opens once the schedule is found
  const handleSelectMeeting = openMeeting

  // Handle popup close - collapse the tool result
  const handleClosePopup = useCallback(() => {
    if (popup) {
      conversationStore.collapseToolResult(
        popup.toolCallId,
        translate("agentScreen:selected", { name: popup.meeting.name }),
      )
    }
    closePopup()
  }, [popup, closePopup, conversationStore])

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

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
      {/* Debug Overlay */}
      {debugMetadata && (
        <View style={themed($debugOverlay)}>
          {debugMetadata.emergency && (
            <Ionicons name="warning" size={14} color="#ef4444" style={$debugWarningIcon} />
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
      <AgentHeader />

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
              {/* CHANGED 2026-11-06 (final review): not over a thread that failed to load. There
                  may be a thread, and the row below says so. */}
              {!historyFailed && (
                <Text style={themed($emptyStateHint)} tx="agentScreen:emptyStateHint" />
              )}
            </View>
          ) : (
            messages.map((message, messageIndex) => (
              <View
                key={message.id}
                style={[
                  themed($messageBubble),
                  message.role === "user" ? themed($userBubble) : themed($assistantBubble),
                ]}
              >
                <View style={themed($messageHeader)} accessible={false}>
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
                    const text = textOfPart(part)
                    if (text !== null) {
                      return (
                        <Text
                          key={`${message.id}-${index}`}
                          style={[
                            themed($messageText),
                            message.role === "user" && $userMessageText,
                          ]}
                        >
                          {text}
                        </Text>
                      )
                    }

                    // CHANGED 2026-11-06 (spec D9): the decision moved to classifyToolPart, because
                    // the thread is now read back from the agent with parts this screen never saw
                    // while it held its own. Null is anything that is not a tool to draw, junk too.
                    const toolView = classifyToolPart(part)
                    if (toolView === null) return null

                    if (toolView.kind === "result") {
                      // Render completed tool results with interactive UI
                      return (
                        <ToolResultRenderer
                          key={`${message.id}-${index}`}
                          part={{
                            type: "tool-result",
                            toolCallId: toolView.toolCallId,
                            toolName: toolView.toolName,
                            result: toolView.output,
                          }}
                          messageId={message.id}
                          onSelectMeeting={handleSelectMeeting}
                          onOpenMyDay={onOpenMyDay}
                        />
                      )
                    }

                    // Tool still in progress - show loading badge.
                    // Only on the reply being written right now. Anything else in a running state
                    // was read back from a stored reply and nothing will ever finish it, so
                    // "Using…" would stay on screen for good.
                    const inProgress =
                      toolView.kind === "running" &&
                      isLoading &&
                      messageIndex === messages.length - 1

                    return (
                      <View key={`${message.id}-${index}`} style={themed($toolCall)}>
                        <Ionicons
                          name={inProgress ? "construct-outline" : "checkmark-done"}
                          size={14}
                          color={theme.colors.textDim}
                        />
                        <Text style={themed($toolCallText)}>
                          {translate(
                            inProgress ? "agentScreen:usingTool" : "agentScreen:toolFinished",
                            { toolName: toolView.toolName },
                          )}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            ))
          )}

          {/* Loading indicator */}
          {isLoading && (
            <View
              style={themed($loadingContainer)}
              accessible
              accessibilityLabel={translate("agentScreen:thinking")}
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator size="small" color={theme.colors.tint} />
              <Text style={themed($loadingText)} tx="agentScreen:thinking" />
            </View>
          )}

          {/* History that failed to load: the composer stays live, as the agent has it anyway */}
          {historyFailed && <LoadFailedRow onRetry={onRetry} />}

          {/* Error display. A stale refusal draws no row: the effect above handles it. */}
          {error && !isStale && (
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
                  handleNewConversation()
                }}
                style={themed($fabMenuItem)}
                accessibilityRole="button"
                accessibilityLabel={translate("agentScreen:newConversation")}
              >
                <Ionicons name="add" size={18} color="#FFF" />
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

      {/* Meeting Detail Popup - shown when user taps a meeting from tool results.
          ADDED 2026-11-08: an in-person card opens the In-Person popup, which has the address,
          directions and "I'm Here"; SchedulePopup has none of those for a venue. */}
      <SchedulePopup
        visible={popup?.venue === "online"}
        meeting={popup?.venue === "online" ? popup.meeting : null}
        onClose={handleClosePopup}
      />
      <InPersonPopup
        visible={popup?.venue === "in_person"}
        meeting={popup?.venue === "in_person" ? popup.meeting : null}
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

const $debugWarningIcon: TextStyle = {
  marginRight: 4,
}

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
  // Was a hardcoded "#000". CHANGED 2026-08-09: same light-mode black-slab fix as
  // the Settings CTA buttons (ba05fea) — the bubble sits on the screen background,
  // so `card` is the step-above surface. It now shares a fill with $assistantBubble,
  // but the two stay distinct the way chat bubbles normally do: opposite alignment,
  // opposite tail corner, and this one's tint border and glow against the other's
  // plain border.
  backgroundColor: colors.card,
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

const $retryButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.xxs,
  paddingHorizontal: spacing.xs,
})

const $retryText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.error,
})

const $loadingPhase: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
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
  // Was a hardcoded "#000". CHANGED 2026-08-09: same light-mode black-slab fix as
  // the Settings CTA buttons (ba05fea). `card` because $inputContainer paints no
  // background of its own — the button sits on the screen background.
  backgroundColor: colors.card,
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
  // CHANGED 2026-11-06 (spec D6): was `colors.error` for Clear conversation. New conversation loses
  // nothing, so it should not read as a danger.
  backgroundColor: colors.tint,
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
