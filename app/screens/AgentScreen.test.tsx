import type { ReactNode } from "react"
import { Alert } from "react-native"
import { act, fireEvent, render, waitFor } from "@testing-library/react-native"
import type { UIMessage } from "ai"

import { AgentScreen } from "./AgentScreen"

// The real Screen imports react-native-keyboard-controller, which throws without its native side.
// What the frame does around the chat is not what these tests are about.
jest.mock("@/components/Screen", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react")
  const { View } = jest.requireActual<typeof import("react-native")>("react-native")
  return {
    Screen: ({ children }: { children: ReactNode }) => createElement(View, null, children),
  }
})

// Both mocks hold their state out here and re-render through a real subscription, because
// AgentScreen and AgentChat are observers: an observer is memoised, so a rerender of the root with
// the same props would never reach them.
const mockListeners = new Set<() => void>()
// The `mock` prefix is what lets a jest.mock factory call it, so the hooks rule needs telling.
/* eslint-disable react-hooks/rules-of-hooks */
function mockUseSubscribed() {
  const { useEffect, useReducer } = jest.requireActual<typeof import("react")>("react")
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const listener = () => bump()
    mockListeners.add(listener)
    return () => {
      mockListeners.delete(listener)
    }
  }, [])
}
/* eslint-enable react-hooks/rules-of-hooks */

/** Change what the mocks answer, and re-render whatever reads them. */
function update(change: () => void) {
  act(() => {
    change()
    mockListeners.forEach((listener) => listener())
  })
}

type ChatOptions = {
  id: string
  messages: UIMessage[]
  transport: {
    sendMessages(options: Record<string, unknown>): Promise<ReadableStream>
  }
  onError?: (error: Error) => void
}

let mockChatOptions: ChatOptions
const mockChat = {
  messages: [] as UIMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: undefined as Error | undefined,
  sendMessage: jest.fn(),
  setMessages: jest.fn(),
  clearError: jest.fn(),
}
function mockFakeUseChat(options: ChatOptions) {
  mockUseSubscribed()
  mockChatOptions = options
  return mockChat
}
// One test swaps in the real SDK, to check these mocks' assumptions about it.
let mockUseChatImpl: (options: ChatOptions) => unknown = mockFakeUseChat
jest.mock("@ai-sdk/react", () => ({
  useChat: (options: ChatOptions) => mockUseChatImpl(options),
}))

const mockExpoFetch = jest.fn()
jest.mock("expo/fetch", () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}))

const mockConversation = {
  view: { phase: "loading" } as
    | { phase: "loading" }
    | { phase: "failed" }
    | {
        phase: "ready"
        id: string
        history: UIMessage[]
        historyFailed: boolean
        readAt: number
      },
  chatState: { current: { busy: false, sentIds: new Set<string>() } },
  retry: jest.fn(),
  reopenStale: jest.fn(),
  startNew: jest.fn(),
}
const mockHookInput = jest.fn()
jest.mock("@/hooks/useAgentConversation", () => ({
  useAgentConversation: (input: { agentUrl: string; enabled: boolean }) => {
    mockUseSubscribed()
    mockHookInput(input)
    return mockConversation
  },
}))

const mockStartRecording = jest.fn()
jest.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    state: "idle",
    error: null,
    startRecording: mockStartRecording,
    stopRecording: jest.fn(),
  }),
}))

jest.mock("@/i18n", () => ({
  translate: (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  getCurrentLanguage: () => "en",
}))

// A stand-in that shows what the screen hands it. The real one needs the meeting row's tree, and
// what it does with a part is its own business. createElement, not JSX: babel's dev JSX adds a
// constant the jest-hoist plugin tries to hoist out of the factory, and it fails on it.
jest.mock("@/components/agent", () => {
  const { createElement } = jest.requireActual<typeof import("react")>("react")
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native")
  return {
    ToolResultRenderer: ({ part }: { part: unknown }) =>
      createElement(Text, { testID: "tool-result" }, JSON.stringify(part)),
  }
})
jest.mock("@/components/SchedulePopup", () => ({ SchedulePopup: () => null }))

const mockTrackEvent = jest.fn()
jest.mock("@/services/tracking", () => ({ trackEvent: (event: string) => mockTrackEvent(event) }))

const mockGetContent = jest.fn()
const mockAgentHeaders = jest.fn()
jest.mock("@/services/api", () => ({
  api: {
    agentHeaders: () => mockAgentHeaders(),
    getContent: (key: string) => mockGetContent(key),
  },
}))

jest.mock("@/utils/logger", () => ({
  logger: {
    child: () => ({ warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }),
  },
}))

const mockProfile = {
  aiConsentAccepted: true,
  fellowship: "AA",
  setAiConsentAccepted: jest.fn(),
}
const mockConversationStore = {
  markConversationOnAgent: jest.fn(),
  collapseToolResult: jest.fn(),
}
let mockAuthenticated = true
jest.mock("@/models", () => ({
  useConfigStore: () => ({ agentUrl: "https://agent.test" }),
  useConversationStore: () => mockConversationStore,
  useProfileStore: () => mockProfile,
  useAuthenticationStore: () => ({ isAuthenticated: mockAuthenticated }),
}))

const CONVERSATION_ID = "conversation-1"

function readyView(overrides: Partial<{ id: string; history: UIMessage[]; readAt: number }> = {}) {
  return {
    phase: "ready" as const,
    id: CONVERSATION_ID,
    history: [],
    historyFailed: false,
    readAt: 1,
    ...overrides,
  }
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] }
}

function assistantMessage(id: string, parts: unknown[]): UIMessage {
  return { id, role: "assistant", parts: parts as UIMessage["parts"] }
}

const REFUSAL_BODY = JSON.stringify({ error: "Conflict", message: "conversation_archived" })

const screenProps = {
  navigation: { goBack: jest.fn() },
  route: { key: "Agent", name: "Agent" },
} as unknown as Parameters<typeof AgentScreen>[0]

function mountScreen() {
  return render(<AgentScreen {...screenProps} />)
}

describe("AgentScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseChatImpl = mockFakeUseChat
    mockChat.messages = []
    mockChat.status = "ready"
    mockChat.error = undefined
    mockConversation.view = readyView()
    mockConversation.chatState = { current: { busy: false, sentIds: new Set() } }
    mockProfile.aiConsentAccepted = true
    mockProfile.fellowship = "AA"
    mockAuthenticated = true
    mockGetContent.mockResolvedValue({ kind: "ok", content: "<p>consent</p>" })
    mockAgentHeaders.mockResolvedValue({ Authorization: "Bearer test" })
  })

  describe("a stale refusal (spec D8)", () => {
    it("puts the words back and reopens on a stale refusal, with no error row", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [
          userMessage("old", "an earlier turn"),
          assistantMessage("reply", [{ type: "text", text: "a reply" }]),
          userMessage("refused", "my words"),
        ]
      })

      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error(REFUSAL_BODY)
      })

      expect(screen.getByDisplayValue("my words")).toBeTruthy()
      expect(mockChat.clearError).toHaveBeenCalledTimes(1)
      expect(mockConversation.reopenStale).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(REFUSAL_BODY)).toBeNull()
    })

    it("puts the returned words before what the person has typed since", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [userMessage("refused", "my words")]
      })
      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "and more")

      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error(REFUSAL_BODY)
      })

      expect(screen.getByDisplayValue("my words and more")).toBeTruthy()
    })

    it("takes the words from the text parts, past any junk", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [
          {
            id: "refused",
            role: "user",
            parts: [
              null,
              { type: "file", url: "x" },
              { type: "text", text: "my words" },
            ] as unknown as UIMessage["parts"],
          },
        ]
      })

      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error(REFUSAL_BODY)
      })

      expect(screen.getByDisplayValue("my words")).toBeTruthy()
    })

    it("takes the words from the person's message, past a partial reply behind it", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [
          userMessage("refused", "my words"),
          assistantMessage("partial", [{ type: "text", text: "half a rep" }]),
        ]
      })

      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error(REFUSAL_BODY)
      })

      expect(screen.getByDisplayValue("my words")).toBeTruthy()
      expect(screen.queryByDisplayValue("half a rep")).toBeNull()
    })

    it("acts once per refusal", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [userMessage("refused", "my words")]
      })
      const refusal = new Error(REFUSAL_BODY)
      update(() => {
        mockChat.status = "error"
        mockChat.error = refusal
      })

      // The same error object on later renders, which a re-run would double the words on.
      update(() => {})
      update(() => {})

      expect(mockConversation.reopenStale).toHaveBeenCalledTimes(1)
      expect(mockChat.clearError).toHaveBeenCalledTimes(1)
      expect(screen.getByDisplayValue("my words")).toBeTruthy()
    })

    it("acts again on a second refusal", () => {
      mountScreen()
      update(() => {
        mockChat.messages = [userMessage("refused", "my words")]
      })
      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error(REFUSAL_BODY)
      })
      update(() => {
        mockChat.error = undefined
      })
      update(() => {
        mockChat.error = new Error(REFUSAL_BODY)
      })

      expect(mockConversation.reopenStale).toHaveBeenCalledTimes(2)
    })

    // The real SDK and the real transport, because these tests' other fake is only what the plan
    // believes about them: that a non-2xx becomes an error whose message is the body.
    it("works through the real useChat and transport", async () => {
      mockUseChatImpl = jest.requireActual<{ useChat: typeof mockUseChatImpl }>(
        "@ai-sdk/react",
      ).useChat
      mockExpoFetch.mockResolvedValue(new Response(REFUSAL_BODY, { status: 409 }))
      const screen = mountScreen()

      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "my words")
      fireEvent.press(screen.getByLabelText("agentScreen:sendMessage"))

      await waitFor(() => expect(mockConversation.reopenStale).toHaveBeenCalledTimes(1))
      expect(screen.getByDisplayValue("my words")).toBeTruthy()
      expect(screen.queryByText(REFUSAL_BODY)).toBeNull()
      const body = JSON.parse(mockExpoFetch.mock.calls[0][1].body)
      expect(body.conversation_id).toBe(CONVERSATION_ID)
      expect(body.messages).toHaveLength(1)
      expect(mockConversation.chatState.current.busy).toBe(false)
    })
  })

  // The real SDK again, for the path these fakes stand in for most: status, stream and messages.
  describe("a turn through the real useChat", () => {
    function uiMessageStream() {
      const chunks = [
        { type: "start", messageId: "reply-1" },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Sky's reply" },
        { type: "text-end", id: "t" },
        { type: "finish" },
      ]
      const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")
      // Not a real Response: jest-expo's globals hold Expo's stream classes while Node's Response
      // hands out Node's, and the SDK pipes one through the other. This body is the global class.
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "text/event-stream" }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`${body}data: [DONE]\n\n`))
            controller.close()
          },
        }),
      }
    }

    beforeEach(() => {
      mockUseChatImpl = jest.requireActual<{ useChat: typeof mockUseChatImpl }>(
        "@ai-sdk/react",
      ).useChat
    })

    it("shows the reply, marks the id on the agent, and ends not busy", async () => {
      mockExpoFetch.mockResolvedValue(uiMessageStream())
      const screen = mountScreen()

      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "my words")
      fireEvent.press(screen.getByLabelText("agentScreen:sendMessage"))

      await waitFor(() => expect(screen.getByText("Sky's reply")).toBeTruthy())
      await waitFor(() => expect(mockConversation.chatState.current.busy).toBe(false))
      expect(screen.getByText("my words")).toBeTruthy()
      // One read holds the whole reply here, and "streaming" was never committed, so this also pins
      // the onFinish path: left fresh, this thread would come back empty after a restart.
      expect(mockConversationStore.markConversationOnAgent).toHaveBeenCalled()
      expect(mockConversation.chatState.current.sentIds.size).toBe(1)
    })

    it("keeps a re-read off a turn that fails, and leaves its words on screen", async () => {
      mockExpoFetch.mockResolvedValue(new Response("<html>502</html>", { status: 502 }))
      const screen = mountScreen()

      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "my words")
      fireEvent.press(screen.getByLabelText("agentScreen:sendMessage"))

      await waitFor(() => expect(screen.getByText("<html>502</html>")).toBeTruthy())
      expect(screen.getByText("my words")).toBeTruthy()
      expect(mockConversation.reopenStale).not.toHaveBeenCalled()
      // The id is what stops a later focus from replacing this list (spec D1).
      expect(mockConversation.chatState.current.sentIds.size).toBe(1)
      // A turn that never streamed leaves the id fresh.
      expect(mockConversationStore.markConversationOnAgent).not.toHaveBeenCalled()
    })
  })

  describe("any other error", () => {
    it("draws today's row for any other error, with no reopen", () => {
      const screen = mountScreen()
      update(() => {
        mockChat.messages = [userMessage("failed", "my words")]
      })
      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "")

      update(() => {
        mockChat.status = "error"
        mockChat.error = new Error("<html>502 Bad Gateway</html>")
      })

      expect(screen.getByText("<html>502 Bad Gateway</html>")).toBeTruthy()
      expect(mockConversation.reopenStale).not.toHaveBeenCalled()
      expect(mockChat.clearError).not.toHaveBeenCalled()
      // The words stay where they are, in the list, and are not also put in the composer.
      expect(screen.queryByDisplayValue("my words")).toBeNull()
      expect(screen.getByText("my words")).toBeTruthy()
    })
  })

  describe("sending (spec D2)", () => {
    /** Run a request through the transport the screen built; the answer does not matter here. */
    async function sendThroughTransport(
      messages: UIMessage[],
      transport = mockChatOptions.transport,
    ) {
      mockExpoFetch.mockResolvedValue(new Response("nope", { status: 500 }))
      await transport
        .sendMessages({
          chatId: CONVERSATION_ID,
          messages,
          trigger: "submit-message",
          messageId: undefined,
          abortSignal: undefined,
        })
        .catch(() => {})
    }

    it("sends the turn and records its id", async () => {
      mountScreen()

      await sendThroughTransport([
        userMessage("old", "an earlier turn"),
        assistantMessage("reply", [{ type: "text", text: "a reply" }]),
        userMessage("turn", "my words"),
      ])

      const [url, init] = mockExpoFetch.mock.calls[0]
      expect(url).toBe("https://agent.test/api/v1/chat")
      // The SDK lower-cases header names.
      expect(init.headers.authorization).toBe("Bearer test")
      const body = JSON.parse(init.body)
      expect(body.conversation_id).toBe(CONVERSATION_ID)
      expect(body.messages.map((m: UIMessage) => m.id)).toEqual(["turn"])
      expect(body.fellowship).toBe("AA")
      expect(typeof body.timezone).toBe("string")
      expect([...mockConversation.chatState.current.sentIds]).toEqual(["turn"])
    })

    it("records no id for a turn that is not the person's words", async () => {
      mountScreen()

      await sendThroughTransport([
        assistantMessage("card", [{ type: "tool-x", state: "approval-responded" }]),
      ])

      expect(JSON.parse(mockExpoFetch.mock.calls[0][1].body).messages).toHaveLength(1)
      expect(mockConversation.chatState.current.sentIds.size).toBe(0)
    })

    // The transport is built once, so it must not close over the fellowship of the mount.
    it("sends the fellowship of the moment, not the mount's", async () => {
      mountScreen()
      const firstTransport = mockChatOptions.transport
      update(() => {
        mockProfile.fellowship = "NA"
      })

      await sendThroughTransport([userMessage("turn", "my words")], firstTransport)

      expect(JSON.parse(mockExpoFetch.mock.calls[0][1].body).fellowship).toBe("NA")
    })

    it("hands useChat the conversation id and the history", () => {
      const history = [userMessage("m1", "stored words")]
      mockConversation.view = readyView({ history })
      mountScreen()

      expect(mockChatOptions.id).toBe(CONVERSATION_ID)
      expect(mockChatOptions.messages).toEqual(history)
    })

    it("sends the composer's words and empties it", () => {
      const screen = mountScreen()
      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), " hello ")
      fireEvent.press(screen.getByLabelText("agentScreen:sendMessage"))

      expect(mockChat.sendMessage).toHaveBeenCalledWith({ text: "hello" })
      expect(mockTrackEvent).toHaveBeenCalledWith("agent_message_sent")
      expect(screen.queryByDisplayValue("hello")).toBeNull()
    })
  })

  describe("following the chat's status", () => {
    it("marks the conversation on the agent when streaming starts", () => {
      mountScreen()
      update(() => {
        mockChat.status = "submitted"
      })
      // Not yet: a turn that fails before streaming leaves the id fresh (spec D1).
      expect(mockConversationStore.markConversationOnAgent).not.toHaveBeenCalled()

      update(() => {
        mockChat.status = "streaming"
      })
      expect(mockConversationStore.markConversationOnAgent).toHaveBeenCalledTimes(1)
    })

    it("mirrors the status into chatState.busy", () => {
      const screen = mountScreen()
      const busy = () => mockConversation.chatState.current.busy
      expect(busy()).toBe(false)

      update(() => {
        mockChat.status = "submitted"
      })
      expect(busy()).toBe(true)
      update(() => {
        mockChat.status = "streaming"
      })
      expect(busy()).toBe(true)
      update(() => {
        mockChat.status = "ready"
      })
      expect(busy()).toBe(false)

      // An unmounted chat runs nothing the hook should wait for, or it would skip every open.
      update(() => {
        mockChat.status = "streaming"
      })
      screen.unmount()
      expect(busy()).toBe(false)
    })
  })

  describe("a re-read landing on the mounted chat", () => {
    const stored = [userMessage("m1", "stored words")]

    it("sets the messages when readAt changes", () => {
      mountScreen()
      expect(mockChat.setMessages).not.toHaveBeenCalled()

      update(() => {
        mockConversation.view = readyView({ history: stored, readAt: 2 })
      })

      expect(mockChat.setMessages).toHaveBeenCalledTimes(1)
      expect(mockChat.setMessages).toHaveBeenCalledWith(stored)
    })

    it.each(["streaming", "submitted"] as const)("does not while %s", (status) => {
      mountScreen()
      update(() => {
        mockChat.status = status
      })

      update(() => {
        mockConversation.view = readyView({ history: stored, readAt: 2 })
      })
      expect(mockChat.setMessages).not.toHaveBeenCalled()

      // Nor when the turn ends: that read predates the turn just shown.
      update(() => {
        mockChat.status = "ready"
      })
      expect(mockChat.setMessages).not.toHaveBeenCalled()
    })

    it("does not on a render with the same readAt", () => {
      mockConversation.view = readyView({ history: stored, readAt: 2 })
      mountScreen()
      update(() => {
        mockChat.status = "error"
      })
      update(() => {
        mockChat.status = "ready"
      })
      expect(mockChat.setMessages).not.toHaveBeenCalled()
    })
  })

  describe("tool parts (spec D9)", () => {
    const part = (state: string) => ({
      type: "tool-searchMeetings",
      toolCallId: "call-1",
      state,
      input: {},
    })

    it("draws a stored running tool part as finished, not a spinner", () => {
      mockChat.messages = [assistantMessage("stored", [part("input-available")])]
      const screen = mountScreen()

      expect(screen.getByText(/agentScreen:toolFinished/)).toBeTruthy()
      expect(screen.getByText("icon:checkmark-done")).toBeTruthy()
      expect(screen.queryByText(/agentScreen:usingTool/)).toBeNull()
    })

    it("draws a running part on the last message while the chat streams", () => {
      mockChat.messages = [assistantMessage("live", [part("input-available")])]
      mockChat.status = "streaming"
      const screen = mountScreen()

      expect(screen.getByText(/agentScreen:usingTool/)).toBeTruthy()
      expect(screen.queryByText(/agentScreen:toolFinished/)).toBeNull()
    })

    it("draws a running part on an earlier message as finished, even while streaming", () => {
      mockChat.messages = [
        assistantMessage("stored", [part("input-available")]),
        userMessage("turn", "my words"),
      ]
      mockChat.status = "streaming"
      const screen = mountScreen()

      expect(screen.getByText(/agentScreen:toolFinished/)).toBeTruthy()
      expect(screen.queryByText(/agentScreen:usingTool/)).toBeNull()
    })

    it("hands a result's output to ToolResultRenderer as part.result", () => {
      mockChat.messages = [
        assistantMessage("stored", [{ ...part("output-available"), output: { meetings: [] } }]),
      ]
      const screen = mountScreen()

      expect(JSON.parse(screen.getByTestId("tool-result").props.children)).toEqual({
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "searchMeetings",
        result: { meetings: [] },
      })
    })

    it("draws nothing for an approval state", () => {
      mockChat.messages = [
        assistantMessage("card", [
          { type: "text", text: "Sky's words" },
          part("approval-requested"),
        ]),
      ]
      const screen = mountScreen()

      expect(screen.getByText("Sky's words")).toBeTruthy()
      expect(screen.queryByText(/agentScreen:toolFinished/)).toBeNull()
      expect(screen.queryByText(/agentScreen:usingTool/)).toBeNull()
    })

    it("does not throw on junk parts", () => {
      mockChat.messages = [
        assistantMessage("junk", [
          null,
          7,
          "text",
          {},
          { type: "text" },
          { type: "text", text: { not: "a string" } },
          { type: "text", text: "the real words" },
        ]),
      ]
      const screen = mountScreen()

      expect(screen.getByText("the real words")).toBeTruthy()
    })
  })

  describe("the outer shell", () => {
    const composer = (screen: ReturnType<typeof mountScreen>) =>
      screen.queryByPlaceholderText("agentScreen:inputPlaceholder")

    it("draws the loading state with no composer", () => {
      mockConversation.view = { phase: "loading" }
      const screen = mountScreen()

      expect(composer(screen)).toBeNull()
      expect(screen.queryByText("agentScreen:loadFailed")).toBeNull()
    })

    it("draws the failed row with a retry and no composer", () => {
      mockConversation.view = { phase: "failed" }
      const screen = mountScreen()

      expect(composer(screen)).toBeNull()
      expect(screen.getByText("agentScreen:loadFailed")).toBeTruthy()
      fireEvent.press(screen.getByLabelText("agentScreen:retry"))
      expect(mockConversation.retry).toHaveBeenCalledTimes(1)
    })

    it("draws the row with a retry over a failed history and leaves the composer live", () => {
      mockConversation.view = { ...readyView(), historyFailed: true }
      const screen = mountScreen()

      expect(screen.getByText("agentScreen:loadFailed")).toBeTruthy()
      expect(composer(screen)?.props.editable).toBe(true)
      fireEvent.press(screen.getByLabelText("agentScreen:retry"))
      expect(mockConversation.retry).toHaveBeenCalledTimes(1)
    })

    // The stale path relies on this: its re-read unmounts the chat.
    it("keeps the words in the composer through loading and a new chat", () => {
      const screen = mountScreen()
      fireEvent.changeText(screen.getByPlaceholderText("agentScreen:inputPlaceholder"), "my words")

      update(() => {
        mockConversation.view = { phase: "loading" }
      })
      expect(composer(screen)).toBeNull()
      update(() => {
        mockConversation.view = readyView({ id: "conversation-2" })
      })

      expect(screen.getByDisplayValue("my words")).toBeTruthy()
    })

    it("remounts the chat when the conversation id changes", () => {
      const screen = mountScreen()
      expect(mockChatOptions.id).toBe(CONVERSATION_ID)

      // A setMessages would be the wrong path: the new thread's history arrives as the mount's.
      const history = [userMessage("m9", "another thread")]
      update(() => {
        mockConversation.view = readyView({ id: "conversation-2", history, readAt: 2 })
      })

      expect(mockChatOptions.id).toBe("conversation-2")
      expect(mockChatOptions.messages).toEqual(history)
      expect(mockChat.setMessages).not.toHaveBeenCalled()
      expect(screen).toBeTruthy()
    })

    it("keeps the consent gate, and is not enabled until consent", () => {
      mockProfile.aiConsentAccepted = false
      const screen = mountScreen()

      expect(screen.getByText("agentScreen:consentAccept")).toBeTruthy()
      expect(composer(screen)).toBeNull()
      expect(mockHookInput).toHaveBeenLastCalledWith({
        agentUrl: "https://agent.test",
        enabled: false,
      })
    })

    it("is enabled with a session and consent, and not without a session", () => {
      mountScreen()
      expect(mockHookInput.mock.lastCall?.[0].enabled).toBe(true)

      update(() => {
        mockAuthenticated = false
      })
      expect(mockHookInput.mock.lastCall?.[0].enabled).toBe(false)
    })
  })

  describe("New conversation (spec D6)", () => {
    it("asks first, with the spec's copy, not styled destructive", () => {
      mockChat.messages = [userMessage("m1", "stored words")]
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {})
      const screen = mountScreen()

      fireEvent.press(screen.getByLabelText("agentScreen:openMenu"))
      expect(screen.getByText("icon:add")).toBeTruthy()
      fireEvent.press(screen.getByLabelText("agentScreen:newConversation"))

      expect(alert).toHaveBeenCalledTimes(1)
      const [title, body, buttons] = alert.mock.calls[0]
      expect(title).toBe("agentScreen:newConversation")
      expect(body).toBe("agentScreen:newConversationConfirm")
      const start = buttons?.find((button) => button.text === "agentScreen:start")
      expect(start?.style).not.toBe("destructive")
      expect(mockConversation.startNew).not.toHaveBeenCalled()

      act(() => start?.onPress?.())
      expect(mockConversation.startNew).toHaveBeenCalledTimes(1)
      alert.mockRestore()
    })
  })
})
