/**
 * Internet oracle — "is the public internet reachable from this device right
 * now?", answered independently of RecoverySky's own infrastructure.
 *
 * ADDED 2026-09-28. NetInfo's `isConnected` only says an interface is up, and
 * its reachability probe is one host that is blocked on some national
 * networks. When our own requests get no answer at all, the question that
 * decides the banner copy is whether ANYTHING answers. So we ask two
 * unrelated anycast providers by IP literal (no DNS in the path — a broken
 * resolver must not read as "no internet"):
 *
 * - https://1.1.1.1/cdn-cgi/trace — Cloudflare, ~200 B plain text.
 * - https://8.8.8.8/resolve?... — Google Public DNS JSON, ~300 B. NOT the
 *   bare https://8.8.8.8/: that 302s to dns.google, which needs DNS.
 *
 * Both serve certificates with the IP in the SAN (verified 2026-09-28), so
 * iOS ATS accepts them without an exception.
 *
 * ANY HTTP response counts as "answered", whatever the status — the round
 * trip is the evidence. Verdict (pure, vitest-covered): `decideOracleVerdict`.
 *
 * Budget: 3 s per probe, both in parallel, so ≤3 s total. An HTTPS probe is
 * ~3 RTTs (TCP, TLS 1.3, request), and a cellular radio waking from idle adds
 * 0.5–2 s, so 2 s risked calling a slow-but-working 3G phone "no internet".
 * Each probe logs its elapsed ms so the budget can be tuned from real data.
 *
 * PRIVACY: probing reveals the device's IP address to Cloudflare and Google,
 * so it only runs AFTER one of our retry ladders has already failed with no
 * answer — never on healthy sessions, never on a timer. The request carries
 * no identifier of ours (example.com is the lookup name on purpose).
 */
import type { OracleProbeOutcome } from "@/utils/connectivityLogic"
import { decideOracleVerdict } from "@/utils/connectivityLogic"

export const ORACLE_TIMEOUT_MS = 3000

const PROBES = [
  { name: "cloudflare", url: "https://1.1.1.1/cdn-cgi/trace" },
  { name: "google", url: "https://8.8.8.8/resolve?name=example.com&type=A" },
] as const

export interface OracleProbeResult {
  outcome: OracleProbeOutcome
  ms: number
}

export interface OracleResult {
  /** true = the internet answered; false = every probe failed; null = not run. */
  reachable: boolean | null
  probes: Record<(typeof PROBES)[number]["name"], OracleProbeResult>
}

async function probe(url: string): Promise<OracleProbeResult> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ORACLE_TIMEOUT_MS)
  try {
    // `no-cors` so the web build gets an opaque (but resolved) response
    // instead of a CORS rejection that would read as "no internet". Native
    // fetch ignores `mode`. `no-store` so a cached answer can't fake a trip.
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    })
    return { outcome: "answered", ms: Date.now() - started }
  } catch {
    return {
      outcome: controller.signal.aborted ? "timeout" : "failed",
      ms: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Probe both providers in parallel; resolves within ~ORACLE_TIMEOUT_MS. Never throws. */
export async function probeInternetOracle(): Promise<OracleResult> {
  const results = await Promise.all(PROBES.map((p) => probe(p.url)))
  const probes = Object.fromEntries(
    PROBES.map((p, i) => [p.name, results[i]]),
  ) as OracleResult["probes"]
  return { reachable: decideOracleVerdict(results.map((r) => r.outcome)), probes }
}

/** Flatten a result into log attributes (Loki structured metadata is flat). */
export function oracleLogAttributes(r: OracleResult): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    oracleReachable: r.reachable === null ? "unknown" : r.reachable,
  }
  for (const [name, p] of Object.entries(r.probes)) {
    attrs[`${name}Outcome`] = p.outcome
    attrs[`${name}Ms`] = p.ms
  }
  return attrs
}
