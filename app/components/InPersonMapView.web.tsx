/**
 * InPersonMapView — WEB STUB. Do not delete without reading this comment.
 *
 * Metro resolves platform-specific extensions (`.web.tsx` / `.ios.tsx` /
 * `.android.tsx`) before the bare `.tsx` file for a matching build target
 * (default Expo/Metro `resolver.platforms` behavior — see metro.config.js,
 * which doesn't override it). For the web bundle, this file is picked
 * instead of InPersonMapView.tsx, so `@maplibre/maplibre-react-native` never
 * enters the web module graph at all.
 *
 * That matters because two of that package's modules call
 * `TurboModuleRegistry.getEnforcing(...)` at MODULE SCOPE, unguarded by any
 * Platform check:
 *   - node_modules/@maplibre/maplibre-react-native/lib/module/components/map/NativeMapViewModule.js
 *   - node_modules/@maplibre/maplibre-react-native/lib/module/components/camera/NativeCameraModule.js
 * `getEnforcing` THROWS when the native module isn't present, which is
 * always true on web. Since InPersonScreen.tsx statically imports
 * InPersonMapView, and MeetingsScreen statically imports InPersonScreen,
 * letting the real (native) component reach the web graph takes down the
 * ENTIRE web bundle at import time — not just the map — the first time
 * anything touches the Meetings tab's module chain, which Metro resolves
 * eagerly regardless of whether the map ever renders.
 *
 * This stub is intentionally inert. `shouldShowMapToggle()`
 * (app/utils/inPersonMapLogic.ts) already returns false on web, so the
 * toggle never appears there and this component is never actually mounted
 * on web — it exists purely to keep MapLibre's native-module imports out of
 * the web bundle's module graph. Rendering `null` (rather than a web-friendly
 * map alternative) matches spec decision #10: web keeps the list-only
 * segment, full stop.
 *
 * Props interface is imported from the native file so the two can't drift
 * out of sync — see the export comment there.
 */

import { FC } from "react"

import type { InPersonMapViewProps } from "./InPersonMapView"

export const InPersonMapView: FC<InPersonMapViewProps> = () => null
