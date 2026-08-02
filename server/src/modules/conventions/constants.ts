/** Constants for the conventions module. */

/**
 * How many top-ranked source files to sample. The brief says 12; the sampler's
 * character budget is the real limit, so this is an upper bound rather than a
 * target.
 */
export const CONVENTION_SAMPLE_FILES = 12;

/**
 * Candidates below this are dropped before the evidence gate even runs.
 * The prompt tells the model the same number, so a lower-confidence candidate
 * means it ignored the instruction — not that it found something marginal.
 */
export const MIN_CONFIDENCE = 0.7;
