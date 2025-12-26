const en = {
  common: {
    ok: "OK!",
    cancel: "Cancel",
    back: "Back",
    logOut: "Log Out",
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
  loginScreen: {
    logIn: "Log In",
    enterDetails:
      "Enter your details below to unlock top secret info. You'll never guess what we've got waiting. Or maybe you will; it's not rocket science here.",
    emailFieldLabel: "Email",
    passwordFieldLabel: "Password",
    emailFieldPlaceholder: "Enter your email address",
    passwordFieldPlaceholder: "Super secret password here",
    tapToLogIn: "Tap to log in!",
    hint: "Hint: you can use any email address and your favorite password :)",
  },
  // Main Navigation
  mainNavigator: {
    homeTab: "Home",
    liveTab: "Live",
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
    joinMeeting: "Join",
    meetingCount: "{{count}} meetings live",
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
    // Account Section
    accountSection: "Account",
    subscription: "Subscription",
    subscriptionFree: "Free",
    subscriptionPremium: "Premium",
    expires: "Expires",
    userId: "User ID",
    deleteUserData: "Delete User Data",
    deleteUserDataConfirm: "Are you sure you want to delete all your user data? This cannot be undone.",
    // App Settings Section
    appSettingsSection: "App Settings",
    language: "Language",
    selectLanguage: "Select Language",
    darkMode: "Dark Mode",
    themeColor: "Theme Color",
    // Actions
    logout: "Logout",
    logoutConfirm: "Are you sure you want to log out?",
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
