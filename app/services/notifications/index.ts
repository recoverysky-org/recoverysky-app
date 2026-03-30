export {
  initializeNotifications,
  registerPushToken as loginNotificationUser,
  unregisterPushToken as logoutNotificationUser,
  requestPermission as requestNotificationPermission,
  hasPermission as hasNotificationPermission,
  optIn as optInNotifications,
  optOut as optOutNotifications,
  getOptedIn as getNotificationsOptedIn,
  setLanguage as setNotificationLanguage,
  addClickHandler as addNotificationClickHandler,
  getLastNotificationResponse,
} from "./expoNotificationService"
