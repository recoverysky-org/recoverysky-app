/**
 * Attendance timer infrastructure shared by the external-Zoom and
 * GPS-verified in-person flows.
 *
 * Deliberately NOT re-exported from @/services/zoom: a compatibility shim
 * would keep the misleading import path alive, which is the thing the
 * 2026-08-05 move was fixing.
 */

export * from "./timerSession"
export * from "./timerRecovery"
export * from "./creditLogic"
