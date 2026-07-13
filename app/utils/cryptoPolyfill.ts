import { getRandomValues, randomUUID } from "expo-crypto"

/**
 * Hermes ships no global `crypto`, so `uuid`'s v4 generator throws
 * "crypto.getRandomValues() does not exist" the first time it runs.
 *
 * This went unnoticed until cloud sync shipped: every other sqlite repository in
 * common-lib writes `input.id || uuid()`, and the id is virtually always
 * supplied by the server or the caller, so the `uuid()` branch never executed on
 * device. `SyncQueueRepository.enqueue()` calls `uuid()` unconditionally — it is
 * the first code path that reaches it on every write.
 *
 * We polyfill from `expo-crypto` rather than `react-native-get-random-values`
 * on purpose: expo-crypto is already linked into the native build, so this stays
 * a JS-only change and keeps the feature shippable over OTA. Adding
 * react-native-get-random-values would introduce a new native module, forcing a
 * `runtimeVersion` bump and a full store release (see CLAUDE.md).
 *
 * `uuid` reads randomness two ways, which is why both properties are set:
 *   - `native.randomUUID` is captured at module-load time, so `crypto.randomUUID`
 *     must exist before `uuid` is imported to be used at all.
 *   - `rng()` binds `crypto.getRandomValues` lazily on first call, so that one
 *     only needs to exist before the first `uuid()`.
 * Setting both means the fast path is taken and the fallback still works.
 *
 * Import this for side effects as the very first statement in `index.tsx`. ES
 * import hoisting guarantees it evaluates before any other module body.
 */
// `globalThis.crypto` is typed as a complete `Crypto` by lib.dom, but at runtime
// on Hermes it is undefined. Widen to a partial so we can build it up piecewise.
const globalRef = globalThis as unknown as { crypto?: Partial<Crypto> }

// Web and newer JSC/Hermes builds may already provide a real `crypto`. Never
// clobber a native implementation — only fill in the individual gaps.
if (!globalRef.crypto) {
  globalRef.crypto = {}
}

if (!globalRef.crypto.getRandomValues) {
  globalRef.crypto.getRandomValues = getRandomValues as Crypto["getRandomValues"]
}

if (!globalRef.crypto.randomUUID) {
  globalRef.crypto.randomUUID = randomUUID as Crypto["randomUUID"]
}
