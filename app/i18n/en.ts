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
    reencrypting: "Securing your data...",
    error: "Database error",
  },
  loginScreen: {
    logIn: "Log In",
    enterDetails:
      "Log in to access app subscriptions and premium features. Subscriptions require a logged in account, or continue anonymously with basic free features.\n\nYou may login and logout at any time in Settings.",
    loginButton: "Login",
    continueAnonymously: "Continue Anonymously",
    openingBrowser: "Opening browser for authentication...",
    euaTitle: "Terms & Conditions",
    euaAgree: "I Agree",
    euaCancel: "Cancel",
  },
  zoomLoginScreen: {
    title: "Connect Zoom",
    subtitle: "Sign in with your Zoom account to join meetings with your identity.",
    connectWithZoom: "Connect with Zoom",
    continueAnonymously: "Continue Anonymously",
    openingBrowser: "Opening Zoom login...",
    or: "or",
    infoText:
      "Connecting your Zoom account lets you join meetings with your display name and profile picture. Your credentials are stored securely on your device.",
  },
  zoomSetupScreen: {
    title: "Zoom Account Required",
    subtitle:
      "A Zoom account is now required to join meetings. Connect your existing account or create a new one.",
    connectWithZoom: "Connect with Zoom",
    createAccount: "Create a Zoom Account",
    continueAnonymously: "Continue Anonymously",
    openingBrowser: "Opening Zoom login...",
    or: "or",
    anonymousWarningTitle: "Limited Anonymous Access",
    anonymousWarningMessage:
      "Joining meetings without a Zoom account may produce errors, as there is a limited number of anonymous joins allowed. If you experience issues, you can connect your Zoom account anytime in Settings.",
    signupModalTitle: "Creating a Zoom Account",
    signupModalBody:
      "After creating your account, Zoom will show a subscription page. You do NOT need to start a free trial.",
    signupModalNote:
      "Once you see the above, close the browser window and return to RecoverySky to log in with your new Zoom account.",
    signupModalNote2:
      "You may click \"Take me to my basic account\" to complete your Zoom profile, then close the browser window and return to RecoverySky.",
    signupModalContinue: "Open Zoom Signup",
    loading: "Checking Zoom connection...",
  },
  // Main Navigation
  mainNavigator: {
    homeTab: "Home",
    liveTab: "Live",
    listingsTab: "Listings",
    attendanceTab: "Attendance",
    meetingsTab: "Meetings",
    scheduleTab: "Schedule",
    agentTab: "Agent",
    settingsTab: "Settings",
  },
  // Main Screens
  homeScreen: {
    title: "Home",
    placeholder: "Dashboard content coming soon",
    // Help Cards
    onboardingTitle: "Welcome to RecoverySky",
    onboardingDescription:
      "Review the app introduction anytime to learn about features and privacy.",
    restartOnboarding: "Restart Initial Questionnaire",
    liveTitle: "Live Meetings",
    liveDescription: "Find meetings happening right now. Tap the Live tab to see what's streaming.",
    goToLive: "Go to Live",
    listingsTitle: "Meeting Listings",
    listingsDescription: "Browse the full schedule by day and time. Great for planning ahead.",
    goToListings: "View Listings",
    attendanceTitle: "Track Attendance",
    attendanceDescription:
      "Your meeting attendance is tracked automatically. View history and export reports.",
    goToAttendance: "View Attendance",
    settingsTitle: "Customize Your App",
    settingsDescription: "Set your recovery date, theme, and personal preferences.",
    goToSettings: "Open Settings",
    // Informational cards
    favoritesTitle: "Favorite Meetings",
    favoritesDescription:
      "Tap the heart to mark meetings you love. Favorites float to the top of your lists. Your favorites are private and stay on your device.",
    ratingsTitle: "Rate Meetings",
    ratingsDescription:
      "Use stars to rate meetings based on your experience. Higher-rated meetings appear first. Your ratings are personal and never shared.",
    // Dashboard
    cleanDays: "Days Clean",
  },
  meetingsScreen: {
    title: "Meetings",
    placeholder: "Meeting list coming soon",
    liveSegment: "Live",
    listingsSegment: "Listings",
  },
  scheduleScreen: {
    title: "Schedule",
    placeholder: "Schedule view coming soon",
  },
  liveScreen: {
    title: "Live Meetings",
    noMeetings: "No meetings are live right now",
    lastRefresh: "Last checked: {{time}}",
    joinMeeting: "Join Meeting",
    joining: "Joining...",
    meetingCount: "{{count}} meetings live",
    meetings: "{{count}} meetings",
    meeting: "{{count}} meeting",
    password: "Password",
    tapToReadMore: "Tap to read more...",
    join: "join",
    joins: "joins",
    min: "min",
    // Schedule grid day names (uppercase)
    mon: "MON",
    tue: "TUE",
    wed: "WED",
    thu: "THU",
    fri: "FRI",
    sat: "SAT",
    sun: "SUN",
  },
  listingsScreen: {
    title: "Meeting Listings",
    emptyState: "No meetings found",
    emptyStateFiltered: "No meetings for {{fellowship}}",
    selectFellowship: "Select a fellowship in Settings",
    meetingCount: "{{count}} meetings",
    // Filter labels
    dayLabel: "Day",
    languageLabel: "Language",
    allLanguages: "All",
    startLabel: "Start",
    endLabel: "End",
    toSeparator: "to",
    // Modal titles
    selectDay: "Select Day",
    selectLanguage: "Select Language",
    startTime: "Start Time",
    endTime: "End Time",
    // Day names
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
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
    pronounNone: "None",
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
    subscriptionAttendance: "Attendance",
    subscriptionPremium: "Premium",
    subscriptionPremiumTrial: "Premium (Trial)",
    notLoggedIn: "Not logged in",
    expires: "Expires",
    upgradeToPro: "Upgrade to Premium",
    manageSubscription: "Manage Subscription",
    loginToSubscribe: "Login to Subscribe",
    loginToSubscribeHint: "App subscriptions require an app account.",
    restorePurchases: "Restore Purchases",
    subscriptionSuccess: "Welcome to Premium!",
    subscriptionSuccessMessage:
      "Thank you for supporting RecoverySky. Enjoy your premium features!",
    restoreSuccess: "Purchases Restored",
    restoreSuccessMessage: "Your subscription has been restored successfully.",
    restoreNoSubscription: "No Subscription Found",
    restoreNoSubscriptionMessage: "We couldn't find any previous purchases to restore.",
    // Zoom Account Section
    zoomAccountSection: "Zoom Account",
    connectZoom: "Connect Zoom Account",
    zoomConnected: "Connected as",
    editZoomProfile: "Edit Zoom Profile",
    zoomDisconnect: "Disconnect Zoom",
    zoomDisconnectConfirm: "Are you sure you want to disconnect your Zoom account?",
    zoomDisconnectSuccess: "Zoom account disconnected",
    // Account Section
    accountSection: "Account",
    userId: "User ID",
    anonymousUser: "Anonymous",
    deleteUserData: "Delete User Data",
    deleteUserDataConfirm:
      "Are you sure you want to delete all your user data? This cannot be undone.",
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
    // Attendance Section
    attendanceSection: "Attendance",
    enableAttendance: "Enable Attendance",
    exportEmail: "Export Email",
    exportEmailPlaceholder: "email@example.com",
    exportAttendance: "Export Attendance",
    // Home Tips
    resetHomeTips: "Reset Home Tips",
    resetHomeTipsHint: "Show all help cards again",
    // Actions
    logout: "Logout",
    logoutConfirm: "Are you sure you want to log out?",
    // Legal Section
    legalSection: "Legal",
    thirdPartyLicenses: "Third-Party Licenses",
    thirdPartyLicensesTitle: "Open Source Licenses",
    close: "Close",
  },
  // Onboarding
  onboarding: {
    // Screen 0: Welcome
    welcomeTitle: "Welcome to RecoverySky!",
    welcomeSubtitle: "We wish you the best in your recovery journey.",
    getStarted: "Get Started",
    // Screen 1: Profile
    profileTitle: "Tell us about yourself",
    profileSubtitle: "This is your in-meeting profile",
    shortName: "Short Name",
    shortNamePlaceholder: "e.g., Joe B.",
    pronouns: "Pronouns",
    selectPronouns: "Select pronouns",
    // Screen 2: Recovery
    recoveryTitle: "Your Recovery",
    recoverySubtitle: "Filters meetings to selected Fellowship. Provides clean date/day display.",
    fellowship: "Fellowship",
    selectFellowship: "Select your fellowship",
    recoveryDate: "Recovery Date",
    otherFellowship: "Other / None",
    // Screen 3: Theme
    themeTitle: "Customize Your App",
    themeSubtitle: "Make it yours",
    darkMode: "Dark Mode",
    themeColor: "Theme Color",
    // Screen 4: Attendance
    attendanceTitle: "Personal Attendance",
    attendanceSubtitle: "Set goals, track progress, and visually celebrate your recovery journey.",
    attendanceFreeFeature:
      "If enabled, meeting attendance is tracked automatically when you join through the app",
    attendancePrivate:
      "Data stays encrypted on your device and only leaves when you choose to export",
    attendancePaidFeature:
      "Subscription: Digitally signed reports for sponsors, courts, or family services",
    enableAttendance: "Enable Attendance Tracking",
    enableAttendanceHint: "You can change this anytime in Settings",
    // Screen 5: Privacy
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
    // Screen 6: Open Source
    ossTitle: "Open Source",
    ossSubtitle: "Built with transparency and trust",
    ossTransparency: "Complete transparency - see exactly how the app works",
    ossSecurity: "Security through openness - anyone can audit the code",
    ossCommunity: "Community-driven development and improvements",
    ossReview: "Review, modify, or contribute to the codebase",
    ossLicense:
      "Licensed under AGPLv3 - you have the freedom to use, study, share, and improve this software.",
    viewSource: "View Source",
    viewLicense: "AGPLv3 License",
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
    attendanceSaved: "Attendance Saved",
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
  // Agent Screen (AI Chat)
  agentScreen: {
    title: "Sky Agent",
    subtitle: "Your AI-powered recovery meeting agent",
    emptyState: "Ask Sky about meetings",
    emptyStateHint:
      "Get help with recovery resources, meeting information, and recovery literature.",
    inputPlaceholder: "Type your message...",
    thinking: "Sky is thinking...",
    noMeetingsFound: "No meetings found",
    meetingsFound_one: "{{count}} meeting found",
    meetingsFound_other: "{{count}} meetings found",
    tapToViewDetails: "Tap a meeting to view details",
  },
}

export default en
export type Translations = typeof en
