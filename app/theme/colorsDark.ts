const palette = {
  // Dark mode: light colors have high numbers, dark have low
  neutral900: "#FFFFFF",
  neutral800: "#F5F5F7",
  neutral700: "#E5E5EA",
  neutral600: "#AEAEB2",
  neutral500: "#8E8E93",
  neutral400: "#48484A",
  neutral300: "#1A1A1C", // cards - subtle elevation
  neutral200: "#141416",
  neutral100: "#0D0D0D", // 95% black

  primary600: "#E3F2FD",
  primary500: "#64B5F6",
  primary400: "#42A5F5",
  primary300: "#2196F3",
  primary200: "#1976D2",
  primary100: "#1565C0",

  secondary500: "#E8F5E9",
  secondary400: "#A5D6A7",
  secondary300: "#81C784",
  secondary200: "#66BB6A",
  secondary100: "#4CAF50",

  accent500: "#FFF3E0",
  accent400: "#FFCC80",
  accent300: "#FFB74D",
  accent200: "#FFA726",
  accent100: "#FF9800",

  angry100: "#FFCDD2",
  angry500: "#EF5350",

  overlay20: "rgba(0, 0, 0, 0.2)",
  overlay50: "rgba(0, 0, 0, 0.5)",
} as const

export const colors = {
  palette,
  transparent: "rgba(0, 0, 0, 0)",
  text: palette.neutral800,
  textDim: palette.neutral600,
  background: palette.neutral100,
  card: palette.neutral300,
  border: palette.neutral400,
  tint: "#FF10F0", // Electric Pink
  tintInactive: palette.neutral400,
  separator: palette.neutral400,
  error: palette.angry500,
  errorBackground: palette.angry100,
} as const
