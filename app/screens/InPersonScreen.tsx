import { FC } from "react"
import { View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"

/**
 * InPersonContent - In-person meetings: nearest-first via /schedules/nearby,
 * day-browse fallback without location. Composed into MeetingsScreen as the
 * middle segment (2026-08-03 in-person UI spec).
 *
 * `active` flips true the first time the user opens the segment — location
 * permission is requested lazily off it, never at app start.
 */
export const InPersonContent: FC<{ active: boolean }> = observer(function InPersonContent(_props) {
  return <View style={$container} />
})

const $container: ViewStyle = { flex: 1 }
