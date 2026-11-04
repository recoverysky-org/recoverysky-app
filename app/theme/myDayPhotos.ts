/**
 * The 13 bundled My Day photos (Pexels, file names kept) and the one picked per launch.
 *
 * ADDED 2026-11-04 (My Day tab). The only file that `require`s the photos. Metro needs literal
 * require() paths, so the list is spelled out rather than built from a directory scan.
 */
import type { ImageSourcePropType } from "react-native"

import { pickPhotoIndex } from "@/utils/myDayPhotoLogic"

export const myDayPhotos: readonly ImageSourcePropType[] = [
  require("@assets/images/my-day/pexels-11088410.jpg"),
  require("@assets/images/my-day/pexels-12181103.jpg"),
  require("@assets/images/my-day/pexels-15950237.jpg"),
  require("@assets/images/my-day/pexels-17402504.jpg"),
  require("@assets/images/my-day/pexels-18874518.jpg"),
  require("@assets/images/my-day/pexels-31195940.jpg"),
  require("@assets/images/my-day/pexels-32047220.jpg"),
  require("@assets/images/my-day/pexels-32049610.jpg"),
  require("@assets/images/my-day/pexels-36700745.jpg"),
  require("@assets/images/my-day/pexels-38459847.jpg"),
  require("@assets/images/my-day/pexels-38856356.jpg"),
  require("@assets/images/my-day/pexels-4504739.jpg"),
  require("@assets/images/my-day/pexels-8549228.jpg"),
]

let coldStartPhoto: ImageSourcePropType | undefined

/**
 * This launch's photo, drawn once and shared by every My Day screen. `??=` makes the first call
 * draw and every later call (including a remount of the tab) return the same photo, so the
 * background never changes under the user mid-session. Same pattern as the Daily Dash's
 * coldStartBackground().
 */
export function coldStartMyDayPhoto(): ImageSourcePropType {
  return (coldStartPhoto ??= myDayPhotos[pickPhotoIndex(myDayPhotos.length)])
}
