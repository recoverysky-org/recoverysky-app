const palette = {
  neutral100: "#FFFFFF",
  neutral200: "#F5F5F7",
  neutral300: "#E5E5EA",
  neutral400: "#C7C7CC",
  neutral500: "#8E8E93",
  neutral600: "#636366",
  neutral700: "#48484A",
  neutral800: "#1C1C1E",
  neutral900: "#000000",

  primary100: "#E3F2FD",
  primary200: "#90CAF9",
  primary300: "#64B5F6",
  primary400: "#42A5F5",
  primary500: "#2196F3",
  primary600: "#1976D2",

  secondary100: "#E8F5E9",
  secondary200: "#A5D6A7",
  secondary300: "#81C784",
  secondary400: "#66BB6A",
  secondary500: "#4CAF50",

  accent100: "#FFF3E0",
  accent200: "#FFCC80",
  accent300: "#FFB74D",
  accent400: "#FFA726",
  accent500: "#FF9800",

  angry100: "#FFEBEE",
  angry500: "#F44336",

  overlay20: "rgba(0, 0, 0, 0.2)",
  overlay50: "rgba(0, 0, 0, 0.5)",
} as const

export const colors = {
  /**
   * The palette is available to use, but prefer using the name.
   * This is only included for rare, one-off cases. Try to use
   * semantic names as much as possible.
   */
  palette,
  /**
   * A helper for making something see-thru.
   */
  transparent: "rgba(0, 0, 0, 0)",
  /**
   * The default text color in many components.
   */
  text: palette.neutral800,
  /**
   * Secondary text information.
   */
  textDim: palette.neutral600,
  /**
   * The default color of the screen background.
   */
  background: palette.neutral200,
  /**
   * Card/section background (slightly different from screen).
   */
  card: palette.neutral100,
  /**
   * The default border color.
   */
  border: palette.neutral300,
  /**
   * The main tinting color.
   */
  tint: palette.primary500,
  /**
   * The inactive tinting color.
   */
  tintInactive: palette.neutral400,
  /**
   * A subtle color used for lines.
   */
  separator: palette.neutral300,
  /**
   * Error messages.
   */
  error: palette.angry500,
  /**
   * Error Background.
   */
  errorBackground: palette.angry100,
} as const
