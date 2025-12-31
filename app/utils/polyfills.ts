/**
 * Polyfills for React Native / Expo streaming support
 *
 * Required for Vercel AI SDK streaming on mobile platforms.
 * Import this file before any other imports in app.tsx.
 *
 * Type declarations are in app/types/polyfills.d.ts
 */

import { Platform } from "react-native"

if (Platform.OS !== "web") {
  const setupPolyfills = async () => {
    const structuredClone = (await import("@ungap/structured-clone")).default
    const { polyfillGlobal } = await import("react-native/Libraries/Utilities/PolyfillFunctions")
    const { TextEncoderStream, TextDecoderStream } =
      await import("@stardazed/streams-text-encoding")

    if (!("structuredClone" in global)) {
      polyfillGlobal("structuredClone", () => structuredClone)
    }

    polyfillGlobal("TextEncoderStream", () => TextEncoderStream)
    polyfillGlobal("TextDecoderStream", () => TextDecoderStream)
  }

  setupPolyfills()
}

export {}
