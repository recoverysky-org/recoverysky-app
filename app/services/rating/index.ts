/**
 * Rating engine — two-stage soft-ask app-rating prompts.
 *
 * Public API. Internals (decide/reducers/state/config) are not exported; callers
 * only ever touch these three entry points. See the design doc / ratingEngine.ts
 * for the model.
 */

export { initRatingEngine, recordEvent, requestRatingFromSettings } from "./ratingEngine"
