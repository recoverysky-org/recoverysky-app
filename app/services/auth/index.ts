// Auth0 authentication (primary)
export * from "./auth0"
export * from "./useAuth0Wrapper"

// Zoom OAuth (separate flow)
export * from "./zoomOAuth"
export * from "./useZoomAuth"

// Legacy Zitadel exports (kept for backward compatibility during migration)
// TODO: Remove after full migration is complete and tested
export * from "./zitadel"
export * from "./useZitadelAuth"
