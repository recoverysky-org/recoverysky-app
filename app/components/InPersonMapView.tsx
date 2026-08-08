/**
 * InPersonMapView — the GL map behind the In-Person segment's list/map toggle.
 *
 * Dumb by design: venues in, taps out. Every decision (feature building,
 * camera fit, id parsing) lives in the pure, vitest-covered
 * app/utils/inPersonMapLogic.ts — do not re-derive any of it here.
 *
 * PRIVACY: `getSearchCenter` is an accessor into useNearbySchedules' coordsRef
 * (the ONE sanctioned new consumer — see that file's header). The fix is read
 * once for the mount-time camera, handed to the native Camera component, and
 * never stored, logged, or tracked here. The puck is MapLibre's native
 * UserLocation — coordinates stay in the GL layer and never enter JS.
 * The tile provider (MapTiler) necessarily sees the viewport; that egress is
 * accepted and documented in the 2026-08-07 map-view spec.
 *
 * Spec: docs/superpowers/specs/2026-08-07-in-person-map-view-design.md
 *
 * API NOTE (2026-08-07): the task brief was written against v11's *documented*
 * API (`MapView`, `ShapeSource`/`ShapeSourceRef`, `CircleLayer`/`SymbolLayer`,
 * `OnPressEvent`, `defaultSettings`, `setCamera`). The installed package
 * (@maplibre/maplibre-react-native 11.3.6) actually exports a different
 * surface: the map component is `Map` (aliased `MapLibreMap` here to avoid
 * shadowing the JS global), sources are `GeoJSONSource`/`GeoJSONSourceRef`,
 * all layer types are one `Layer` component discriminated by a `type` prop
 * with style-spec `paint`/`layout` (kebab-case) instead of the deprecated
 * `style` prop, press events arrive as `NativeSyntheticEvent<PressEventWithFeatures>`
 * (read via `event.nativeEvent`), cluster expansion takes a numeric
 * `cluster_id` instead of the feature, and the camera imperative API is
 * `easeTo`/`flyTo`/`fitBounds` instead of `setCamera`. Every name below is
 * the real export — see task-7-report.md for the full deviation table with
 * typings file:line citations.
 */

import { FC, useCallback, useMemo, useRef } from "react"
import type { NativeSyntheticEvent, ViewStyle } from "react-native"
import { getLocales } from "expo-localization"
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  type InitialViewState,
  Layer,
  type LngLatBounds,
  Map as MapLibreMap,
  type PressEventWithFeatures,
  UserLocation,
} from "@maplibre/maplibre-react-native"

import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import {
  boundsForRadius,
  boundsForVenues,
  type CameraBounds,
  defaultCameraForRegion,
  parseVenueIds,
  venuesToFeatureCollection,
} from "@/utils/inPersonMapLogic"

interface InPersonMapViewProps {
  meetings: MeetingWithTrex[]
  /** Theme-appropriate style URL from ConfigStore (never "" — caller gates) */
  mapStyleUrl: string
  /** Accessor for the user's fix — a function, NOT a value, so coords never sit in props/state */
  getSearchCenter: () => { lat: number; lon: number } | null
  radiusKm: number
  /** Pin tapped → meeting ids at that venue (caller resolves + opens popup/chooser) */
  onVenuePress: (meetingIds: string[]) => void
  /** Style/tile load failure → caller toasts + flips back to list */
  onMapFailed: () => void
}

/**
 * Reshapes the pure module's `{ne, sw}` bounds into MapLibre's flat
 * `[west, south, east, north]` LngLatBounds tuple. This is a data-format
 * adapter for the native API, not a decision — the box itself always comes
 * from boundsForRadius / boundsForVenues in inPersonMapLogic.ts.
 */
function toLngLatBounds(bounds: CameraBounds): LngLatBounds {
  return [bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]]
}

export const InPersonMapView: FC<InPersonMapViewProps> = ({
  meetings,
  mapStyleUrl,
  getSearchCenter,
  radiusKm,
  onVenuePress,
  onMapFailed,
}) => {
  const { theme } = useAppTheme()
  const cameraRef = useRef<CameraRef>(null)
  const shapeSourceRef = useRef<GeoJSONSourceRef>(null)

  const featureCollection = useMemo(() => venuesToFeatureCollection(meetings), [meetings])

  // Mount-time only, by design: refitting on every result change would yank
  // the map out from under a panning user. Toggling list→map remounts this
  // component, which is exactly when a fresh fit is wanted.
  const initialViewState = useMemo<InitialViewState>(() => {
    const center = getSearchCenter()
    if (center) return { bounds: toLngLatBounds(boundsForRadius(center.lat, center.lon, radiusKm)) }
    const venueBounds = boundsForVenues(featureCollection)
    if (venueBounds) return { bounds: toLngLatBounds(venueBounds) }
    const fallback = defaultCameraForRegion(getLocales()[0]?.regionCode)
    return { center: fallback.centerCoordinate, zoom: fallback.zoomLevel }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSourcePress = useCallback(
    async (event: NativeSyntheticEvent<PressEventWithFeatures>) => {
      const feature = event.nativeEvent.features[0]
      if (!feature) return
      const properties = feature.properties ?? {}

      if (properties.cluster) {
        // Cluster tap → expand. v11's getClusterExpansionZoom takes the
        // numeric cluster_id property, not the feature object the brief
        // assumed — see task-7-report.md deviation table.
        const clusterId = properties.cluster_id
        if (typeof clusterId !== "number") return
        const zoom = await shapeSourceRef.current?.getClusterExpansionZoom(clusterId)
        if (feature.geometry.type !== "Point") return
        const [lon, lat] = feature.geometry.coordinates
        cameraRef.current?.easeTo({
          center: [lon, lat],
          // +0.5 past the expansion zoom so the leaves separate visibly
          // instead of landing exactly at the split threshold.
          zoom: (zoom ?? 14) + 0.5,
          duration: 300,
        })
        return
      }

      const ids = parseVenueIds(properties.ids)
      if (ids.length > 0) onVenuePress(ids)
    },
    [onVenuePress],
  )

  return (
    <MapLibreMap style={$map} mapStyle={mapStyleUrl} onDidFailLoadingMap={onMapFailed} attribution>
      <Camera ref={cameraRef} initialViewState={initialViewState} />

      <GeoJSONSource
        id="inperson-venues"
        ref={shapeSourceRef}
        data={featureCollection}
        cluster
        clusterRadius={50}
        onPress={handleSourcePress}
      >
        {/* Cluster bubble + count */}
        <Layer
          type="circle"
          id="inperson-clusters"
          source="inperson-venues"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": theme.colors.tint,
            "circle-radius": 18,
            "circle-opacity": 0.85,
          }}
        />
        <Layer
          type="symbol"
          id="inperson-cluster-count"
          source="inperson-venues"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 12,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{ "text-color": "#ffffff" }}
        />

        {/* Approximate venues: translucent area, NEVER a precise pin (spec
            decision #7 — deliberately-fuzzed coordinates must not be
            pinpointed; matches the popup's "approximate" caveat line). */}
        <Layer
          type="circle"
          id="inperson-venue-approx"
          source="inperson-venues"
          filter={["all", ["!", ["has", "point_count"]], ["==", ["get", "approximate"], true]]}
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": 0.3,
            "circle-radius": 22,
            "circle-stroke-width": 1,
            "circle-stroke-color": ["get", "color"],
          }}
        />

        {/* Precise venues: fellowship-colored dot */}
        <Layer
          type="circle"
          id="inperson-venue-pins"
          source="inperson-venues"
          filter={["all", ["!", ["has", "point_count"]], ["!=", ["get", "approximate"], true]]}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": 9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          }}
        />

        {/* Multi-meeting venues wear their count, like a mini-cluster that
            can't expand (the points are identical) — the tap opens a chooser
            instead (see InPersonScreen's VenueMeetingsModal). */}
        <Layer
          type="symbol"
          id="inperson-venue-count"
          source="inperson-venues"
          filter={["all", ["!", ["has", "point_count"]], [">", ["get", "count"], 1]]}
          layout={{
            "text-field": ["to-string", ["get", "count"]],
            "text-size": 11,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{ "text-color": "#ffffff" }}
        />
      </GeoJSONSource>

      {/* Native blue-dot puck: renders inside the GL layer, coords never
          enter JS (spec decision #8). v11 dropped the `visible` prop that
          the brief expected — UserLocationProps has no such prop, so simply
          mounting the component is what shows it. */}
      <UserLocation />
    </MapLibreMap>
  )
}

const $map: ViewStyle = {
  flex: 1,
}
