# RecoverySky Analytics Events

Umami analytics event reference for the RecoverySky app. Events are sent via the Umami HTTP Tracking API (`/api/send`).

## Event Format

All events use `trackEvent(name, data?)` or automatic `trackScreenView(screenName)`.

```
POST ${UMAMI_URL}/api/send
{
  "type": "event",
  "payload": {
    "website": "<websiteId>",
    "hostname": "ios | android | web",
    "url": "/<screenName>",
    "name": "<eventName>",
    "data": { ... },
    "language": "en | es",
    "screen": "390x844",
    "id": "<userId>"
  }
}
```

---

## Core Funnel Events (Initial Rollout)

### Group 1: Session

| Event | Description | Data | Source |
|---|---|---|---|
| `app_initialized` | App startup completed (stores loaded, config fetched, services initialized) | `{ sessionId }` | `app/app.tsx` |
| `app_foregrounded` | App returned to foreground from background/inactive | `{ backgrounded_ms }` | `app/app.tsx` (AppState listener) |
| _(automatic)_ | Screen views fire on every navigation state change | — | `app/navigators/navigationUtilities.ts` |

### Group 2: Auth & Onboarding

| Event | Description | Data | Source |
|---|---|---|---|
| `login_completed` | User authenticated successfully | `{ method: "oauth" \| "anonymous" }` | `app/screens/LoginScreen.tsx` |
| `logout` | User logged out from settings | — | `app/screens/SettingsScreen.tsx` |
| `onboarding_step` | User advanced through an onboarding step | `{ step: "welcome" \| "profile" \| "recovery" \| "theme" \| "attendance" \| "privacy" \| "oss" }` | `app/screens/onboarding/*.tsx` |
| `onboarding_completed` | User finished the full onboarding flow | — | `app/screens/onboarding/OnboardingOSS.tsx` |
| `firebase_import` | User imported data from the old Firebase app | — | `app/screens/onboarding/OnboardingImport.tsx` |

### Group 3: Meetings

| Event | Description | Data | Source |
|---|---|---|---|
| `meeting_joined` | User joined a Zoom meeting | `{ fellowship }` | `app/components/SchedulePopup.tsx` |
| `meeting_favorited` | User toggled a meeting favorite | `{ action: "add" \| "remove" }` | `app/components/SchedulePopup.tsx` |

### Group 4: Attendance

| Event | Description | Data | Source |
|---|---|---|---|
| `report_sent` | Attendance report sent to email | `{ type: "initial" \| "resend" \| "replace" \| "forward" }` | `app/hooks/useReportSender.ts` |
| `report_confirmed` | Report delivery confirmed via polling | — | `app/hooks/useReportSender.ts` |

### Group 5: Subscription

| Event | Description | Data | Source |
|---|---|---|---|
| `paywall_shown` | RevenueCat paywall presented to user | `{ source: string }` | `app/context/SubscriptionContext.tsx` |
| `purchase_completed` | User completed a subscription purchase | `{ entitlement }` | `app/context/SubscriptionContext.tsx` |
| `purchase_restored` | User restored a previous purchase | — | `app/context/SubscriptionContext.tsx` |

### Group 6: Feature Adoption

| Event | Description | Data | Source |
|---|---|---|---|
| `agent_message_sent` | User sent a message to the AI agent | — | `app/screens/AgentScreen.tsx` |
| `notification_toggle` | User toggled push notification preference | `{ enabled: boolean }` | `app/screens/SettingsScreen.tsx` |
| `language_changed` | User changed app language | `{ language }` | `app/screens/SettingsScreen.tsx` |

### Group 7: Errors

| Event | Description | Data | Source |
|---|---|---|---|
| `api_error` | API call returned an error | `{ endpoint, kind }` | `app/services/api/index.ts` |
| `report_delivery_failed` | Attendance report delivery failed | — | `app/hooks/useReportSender.ts` |

### Group 8: Settings & Account

| Event | Description | Data | Source |
|---|---|---|---|
| `zoom_connected` | User connected their Zoom account | — | `app/screens/ZoomSetupScreen.tsx`, `app/screens/ZoomLoginScreen.tsx` |
| `data_deleted` | User deleted all app data | — | `app/screens/SettingsScreen.tsx` |

---

## Future Events (Discovered Touchpoints)

These events have been identified as valuable but are not included in the initial rollout. Add incrementally as needed.

### Session & Lifecycle

| Event | Description | Data | Source |
|---|---|---|---|
| `app_backgrounded` | App moved to background | — | `app/app.tsx` (AppState listener) |
| `deep_link_opened` | App opened via deep link | `{ url }` | `app/app.tsx` (Linking) |
| `error_boundary_triggered` | React error boundary caught an error | `{ componentStack }` | `app/screens/ErrorScreen/ErrorBoundary.tsx` |
| `unhandled_error` | Global unhandled error captured | `{ source, name, message, isFatal }` | `app/utils/errorHandler.ts` |

### Authentication

| Event | Description | Data | Source |
|---|---|---|---|
| `login_started` | User initiated login flow | `{ method: "oauth" \| "anonymous" }` | `app/screens/LoginScreen.tsx` |
| `login_failed` | Login attempt failed | `{ error }` | `app/screens/LoginScreen.tsx` |
| `terms_accepted` | User accepted terms/EUA | — | `app/screens/LoginScreen.tsx` |
| `device_attestation_completed` | Device attestation flow completed | `{ method: "attestation" \| "api_key" }` | `app/app.tsx` |
| `token_refreshed` | OAuth access token refreshed | — | `app/services/auth/` |

### Onboarding (Granular)

| Event | Description | Data | Source |
|---|---|---|---|
| `onboarding_skipped` | User skipped a specific onboarding step | `{ step }` | `app/screens/onboarding/*.tsx` |
| `onboarding_profile_set` | Profile fields set during onboarding | `{ hasName, hasPronouns }` | `app/screens/onboarding/OnboardingProfile.tsx` |
| `onboarding_recovery_set` | Recovery details set | `{ fellowship, hasDate }` | `app/screens/onboarding/OnboardingRecovery.tsx` |
| `onboarding_theme_set` | Theme preferences set | `{ darkMode, color }` | `app/screens/onboarding/OnboardingTheme.tsx` |
| `onboarding_attendance_toggled` | Attendance tracking toggled during onboarding | `{ enabled }` | `app/screens/onboarding/OnboardingAttendance.tsx` |
| `firebase_import_started` | Firebase import initiated | — | `app/screens/onboarding/OnboardingImport.tsx` |
| `firebase_import_failed` | Firebase import failed | `{ error }` | `app/screens/onboarding/OnboardingImport.tsx` |
| `firebase_import_skipped` | User skipped Firebase import | — | `app/screens/onboarding/OnboardingImport.tsx` |

### Meeting Engagement

| Event | Description | Data | Source |
|---|---|---|---|
| `meeting_popup_opened` | Meeting detail popup shown | `{ meetingId, fellowship }` | `app/components/SchedulePopup.tsx` |
| `meeting_popup_closed` | Meeting detail popup dismissed | — | `app/components/SchedulePopup.tsx` |
| `meeting_rated` | User rated a meeting (1-5 stars) | `{ stars }` | `app/components/SchedulePopup.tsx` |
| `meeting_description_expanded` | User expanded meeting description | — | `app/components/SchedulePopup.tsx` |
| `meeting_join_started` | User pressed Join button (before SDK loads) | `{ fellowship }` | `app/components/SchedulePopup.tsx` |
| `meeting_join_failed` | Zoom join attempt failed | `{ error }` | `app/services/zoom/` |
| `live_filter_changed` | Live meetings fellowship filter changed | `{ fellowship }` | `app/screens/LiveScreen.tsx` |
| `live_refreshed` | Manual refresh triggered on live meetings | — | `app/screens/LiveScreen.tsx` |
| `listings_filter_changed` | Listings filter changed (day/fellowship/language) | `{ day?, fellowship?, language? }` | `app/screens/ListingsScreen.tsx` |
| `listings_day_selected` | User selected a day in listings | `{ day }` | `app/screens/ListingsScreen.tsx` |

### Attendance (Granular)

| Event | Description | Data | Source |
|---|---|---|---|
| `attendance_created` | Attendance record created (meeting joined) | — | `app/db/attendanceEvents.ts` |
| `attendance_archived` | Attendance record archived | — | `app/db/attendanceEvents.ts` |
| `attendance_selected` | Attendance records selected for batch report | `{ count }` | `app/screens/AttendanceScreen.tsx` |
| `attendance_section_changed` | User switched attendance tab section | `{ section: "new" \| "archive" \| "reports" }` | `app/screens/AttendanceScreen.tsx` |
| `report_html_viewed` | User viewed report HTML in WebView | — | `app/screens/AttendanceScreen.tsx` |
| `report_email_changed` | User changed report email address | — | `app/screens/AttendanceScreen.tsx` |
| `attendance_deleted` | Attendance record deleted | — | `app/screens/AttendanceScreen.tsx` |

### Subscription (Granular)

| Event | Description | Data | Source |
|---|---|---|---|
| `paywall_dismissed` | User dismissed paywall without purchasing | `{ source }` | `app/context/SubscriptionContext.tsx` |
| `purchase_failed` | Purchase attempt failed | `{ error }` | `app/context/SubscriptionContext.tsx` |
| `premium_feature_blocked` | User tried a premium feature without subscription | `{ feature }` | Various screens |
| `subscription_status_changed` | Subscription status changed (upgrade/downgrade/expire) | `{ isPremium, hasAttendance }` | `app/context/SubscriptionContext.tsx` |

### Reminders

| Event | Description | Data | Source |
|---|---|---|---|
| `reminder_created` | User created a meeting reminder | `{ minutesBefore }` | `app/components/ReminderEditorModal.tsx` |
| `reminder_updated` | User updated a reminder | — | `app/components/ReminderEditorModal.tsx` |
| `reminder_deleted` | User deleted a reminder | — | `app/components/ReminderEditorModal.tsx` |
| `reminder_toggled` | User enabled/disabled a reminder | `{ enabled }` | `app/components/ReminderEditorModal.tsx` |

### AI Agent

| Event | Description | Data | Source |
|---|---|---|---|
| `agent_screen_opened` | User opened the AI agent tab | — | `app/screens/AgentScreen.tsx` |
| `agent_tool_called` | Agent executed a tool call | `{ tool }` | `app/screens/AgentScreen.tsx` |
| `agent_meeting_opened` | User opened a meeting from agent results | — | `app/screens/AgentScreen.tsx` |
| `agent_conversation_cleared` | User cleared conversation history | — | `app/screens/AgentScreen.tsx` |

### Notifications

| Event | Description | Data | Source |
|---|---|---|---|
| `notification_permission_requested` | OS notification permission dialog shown | — | `app/services/notifications/expoNotificationService.ts` |
| `notification_permission_granted` | User granted notification permission | — | `app/services/notifications/expoNotificationService.ts` |
| `notification_permission_denied` | User denied notification permission | — | `app/services/notifications/expoNotificationService.ts` |
| `notification_clicked` | User tapped a push notification | `{ screen }` | `app/app.tsx` |

### Settings (Granular)

| Event | Description | Data | Source |
|---|---|---|---|
| `profile_name_changed` | User changed display name | — | `app/screens/SettingsScreen.tsx` |
| `profile_pronouns_changed` | User changed pronouns | `{ pronouns }` | `app/screens/SettingsScreen.tsx` |
| `profile_recovery_date_changed` | User changed recovery date | — | `app/screens/SettingsScreen.tsx` |
| `profile_fellowship_changed` | User changed fellowship | `{ fellowship }` | `app/screens/SettingsScreen.tsx` |
| `theme_changed` | User changed dark/light mode | `{ darkMode }` | `app/screens/SettingsScreen.tsx` |
| `theme_color_changed` | User changed theme color | `{ color }` | `app/screens/SettingsScreen.tsx` |
| `zoom_reconnected` | User reconnected Zoom from settings | — | `app/screens/ZoomLoginScreen.tsx` |
| `zoom_disconnected` | User disconnected Zoom | — | `app/screens/SettingsScreen.tsx` |
| `onboarding_restarted` | User restarted onboarding from settings | — | `app/screens/SettingsScreen.tsx` |
| `licenses_viewed` | User opened OSS licenses screen | — | `app/screens/SettingsScreen.tsx` |
| `app_review_prompted` | Store review dialog shown | — | `app/services/review/` |

### External Links

| Event | Description | Data | Source |
|---|---|---|---|
| `external_link_opened` | User opened an external link | `{ url }` | Various screens |
| `privacy_policy_opened` | User opened privacy policy | — | `app/screens/onboarding/OnboardingPrivacy.tsx` |
| `terms_opened` | User opened terms of service | — | `app/screens/onboarding/OnboardingPrivacy.tsx` |
| `support_opened` | User opened support website | — | `app/screens/HomeScreen.tsx` |
| `source_code_opened` | User opened source code link | — | `app/screens/onboarding/OnboardingOSS.tsx` |

### Journal Export

| Event | Description | Data | Source |
|---|---|---|---|
| `journal_export_started` | User initiated journal PDF export | — | `app/hooks/useJournalExport.ts` |
| `journal_export_completed` | Journal PDF generated and shared | `{ entryCount }` | `app/hooks/useJournalExport.ts` |
| `journal_export_failed` | Journal export failed | `{ code: "not_found" \| "empty" \| "generation" }` | `app/hooks/useJournalExport.ts` |
