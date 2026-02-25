export {
  initializeOneSignal,
  loginUser as loginOneSignalUser,
  logoutUser as logoutOneSignalUser,
  requestPermission as requestNotificationPermission,
  hasPermission as hasNotificationPermission,
  optIn as optInNotifications,
  optOut as optOutNotifications,
  getOptedIn as getNotificationsOptedIn,
  setLanguage as setNotificationLanguage,
  addClickHandler as addNotificationClickHandler,
} from "./oneSignalService"
