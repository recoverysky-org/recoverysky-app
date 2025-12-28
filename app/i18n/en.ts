const en = {
  common: {
    ok: "OK!",
    cancel: "Cancel",
    back: "Back",
    logOut: "Log Out",
    apply: "Apply",
  },
  welcomeScreen: {
    postscript:
      "psst  — This probably isn't what your app looks like. (Unless your designer handed you these screens, and in that case, ship it!)",
    readyForLaunch: "Your app, almost ready for launch!",
    exciting: "(ohh, this is exciting!)",
    letsGo: "Let's go!",
  },
  errorScreen: {
    title: "Something went wrong!",
    friendlySubtitle:
      "This is the screen that your users will see in production when an error is thrown. You'll want to customize this message (located in `app/i18n/en.ts`) and probably the layout as well (`app/screens/ErrorScreen`). If you want to remove this entirely, check `app/app.tsx` for the <ErrorBoundary> component.",
    reset: "RESET APP",
    traceTitle: "Error from %{name} stack",
  },
  emptyStateComponent: {
    generic: {
      heading: "So empty... so sad",
      content: "No data found yet. Try clicking the button to refresh or reload the app.",
      button: "Let's try this again",
    },
  },
  errors: {
    invalidEmail: "Invalid email address.",
  },
  database: {
    initializing: "Initializing database...",
    seeding: "Seeding database...",
    error: "Database error",
  },
  loginScreen: {
    logIn: "Log In",
    enterDetails: "Sign in to sync your data across devices, or continue anonymously.",
    loginButton: "Login",
    continueAnonymously: "Continue Anonymously",
    openingBrowser: "Opening browser for authentication...",
  },
  // Main Navigation
  mainNavigator: {
    homeTab: "Home",
    liveTab: "Live",
    attendanceTab: "Attendance",
    meetingsTab: "Meetings",
    scheduleTab: "Schedule",
    settingsTab: "Settings",
  },
  // Main Screens
  homeScreen: {
    title: "Home",
    placeholder: "Dashboard content coming soon",
  },
  meetingsScreen: {
    title: "Meetings",
    placeholder: "Meeting list coming soon",
  },
  scheduleScreen: {
    title: "Schedule",
    placeholder: "Schedule view coming soon",
  },
  liveScreen: {
    title: "Live Now",
    noMeetings: "No meetings are live right now",
    lastRefresh: "Last checked: {{time}}",
    joinMeeting: "Join Meeting",
    meetingCount: "{{count}} meetings live",
    meetings: "{{count}} meetings",
    password: "Password",
  },
  attendanceScreen: {
    title: "Attendance",
    noRecords: "No pending attendance records",
    noRecordsSubtext: "Your attendance will appear here after joining meetings",
    addToReport: "Add to Report",
    credit: "credit",
    minutes: "min",
  },
  settingsScreen: {
    title: "Settings",
    subtitle: "Manage your account and preferences",
    // Profile Section
    profileSection: "Profile",
    displayName: "Display Name",
    shortName: "Short Name",
    shortNamePlaceholder: "e.g., Joe B.",
    showCleanDate: "Show Recovery Date",
    showCleanDays: "Show Recovery Days",
    showPronouns: "Show Pronouns",
    pronouns: "Pronouns",
    selectPronouns: "Select Pronouns",
    pronounHeHim: "He/Him",
    pronounSheHer: "She/Her",
    pronounTheyThem: "They/Them",
    pronounEmErs: "Em/Ers",
    cleanDaysFormat: "{{count}}d",
    // Recovery Section
    recoverySection: "Recovery",
    recoveryDate: "Recovery Date",
    recoveryFellowship: "Recovery Fellowship",
    selectFellowship: "Select fellowship",
    // Subscription Section
    subscriptionSection: "Subscription",
    subscription: "Status",
    subscriptionFree: "Free",
    subscriptionPremium: "Premium",
    expires: "Expires",
    upgradeToPro: "Upgrade to Pro",
    manageSubscription: "Manage Subscription",
    restorePurchases: "Restore Purchases",
    subscriptionSuccess: "Welcome to Pro!",
    subscriptionSuccessMessage: "Thank you for supporting RecoverySky. Enjoy your premium features!",
    restoreSuccess: "Purchases Restored",
    restoreSuccessMessage: "Your subscription has been restored successfully.",
    restoreNoSubscription: "No Subscription Found",
    restoreNoSubscriptionMessage: "We couldn't find any previous purchases to restore.",
    // Account Section
    accountSection: "Account",
    userId: "User ID",
    anonymousUser: "Anonymous",
    deleteUserData: "Delete User Data",
    deleteUserDataConfirm: "Are you sure you want to delete all your user data? This cannot be undone.",
    // App Settings Section
    appSettingsSection: "App Settings",
    language: "Language",
    selectLanguage: "Select Language",
    darkMode: "Dark Mode",
    themeColor: "Theme Color",
    currentColor: "Current",
    pastelColors: "Pastels",
    vibrantColors: "Vibrant",
    customColor: "Custom Color",
    resetToDefault: "Reset to Default",
    // Actions
    logout: "Logout",
    logoutConfirm: "Are you sure you want to log out?",
  },
  // Onboarding
  onboarding: {
    // Screen 0: Welcome
    welcomeTitle: "Welcome to RecoverySky!",
    welcomeSubtitle: "We wish you the best in your recovery journey.",
    getStarted: "Get Started",
    // Screen 1: Profile
    profileTitle: "Tell us about yourself",
    profileSubtitle: "This helps personalize your experience",
    shortName: "Short Name",
    shortNamePlaceholder: "e.g., Joe B.",
    pronouns: "Pronouns",
    selectPronouns: "Select pronouns",
    // Screen 2: Recovery
    recoveryTitle: "Your Recovery",
    recoverySubtitle: "Optional - you can add this later",
    fellowship: "Fellowship",
    selectFellowship: "Select your fellowship",
    recoveryDate: "Recovery Date",
    otherFellowship: "Other / None",
    // Screen 3: Theme
    themeTitle: "Customize Your App",
    themeSubtitle: "Make it yours",
    darkMode: "Dark Mode",
    themeColor: "Theme Color",
    // Screen 4: Privacy
    privacyTitle: "Your Privacy Matters",
    privacySubtitle: "We take your privacy seriously",
    dataOnDevice: "Your data never leaves your device",
    noTracking: "No analytics, no tracking, no Google",
    totalAnonymity: "Complete privacy and anonymity",
    minimalNetwork: "Only network traffic is for live meeting lists",
    encryptedStorage: "100% local encrypted SQL storage",
    hipaaCompliant: "HIPAA compliant network and storage",
    openSource: "Open source - available for review and security testing",
    privacyPolicy: "Privacy Policy",
    termsOfService: "Terms of Service",
    // Common
    next: "Next",
    finish: "Finish",
    skipForNow: "Skip for now",
  },
  // Zoom Meeting
  zoomMeeting: {
    joining: "Joining meeting...",
    joinFailed: "Failed to join meeting",
    retry: "Try Again",
    openExternal: "Open in Zoom App",
    permissionRequired: "Camera and microphone access required",
    joinMeeting: "Join Meeting",
    shortMeetingTitle: "Meeting Too Short",
    shortMeetingMessage:
      "Your meeting was only {{minutes}} minute(s). At least {{required}} minute(s) are required to receive attendance credit. This record will not appear in your attendance history.",
    dontShowAgain: "Don't show again",
  },
  // Dev Screen (hidden)
  devScreen: {
    title: "Developer Tools",
    reportBugs: "Report Bugs",
    reactotron: "Send to Reactotron",
    androidReactotronHint:
      "If this doesn't work, ensure the Reactotron desktop app is running, run adb reverse tcp:9090 tcp:9090 from your terminal, and reload the app.",
    iosReactotronHint:
      "If this doesn't work, ensure the Reactotron desktop app is running and reload app.",
    macosReactotronHint:
      "If this doesn't work, ensure the Reactotron desktop app is running and reload app.",
    webReactotronHint:
      "If this doesn't work, ensure the Reactotron desktop app is running and reload app.",
    windowsReactotronHint:
      "If this doesn't work, ensure the Reactotron desktop app is running and reload app.",
  },
}

export default en
export type Translations = typeof en
