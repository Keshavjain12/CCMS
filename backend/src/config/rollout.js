// =========================================================================
// ROLLOUT CONFIG  —  Orient Paper & Mill CCMS
// Section 12.8 — Phased Rollout Plan
//
// Controls which business lines and regions are LIVE vs PILOT vs BLOCKED.
// Every complaint creation is checked against this gate before proceeding.
//
// Phases:
//   Phase 1 (Pilot)  — Paper business line, North India region only
//   Phase 2          — Paper all regions + Chemical North India
//   Phase 3 (Full)   — Paper + Chemical, all regions
//
// Current phase is set by ROLLOUT_PHASE in .env (1, 2, or 3).
// Individual overrides can be set per business line/region in .env too.
// =========================================================================

require("dotenv").config();

const ROLLOUT_PHASE = parseInt(process.env.ROLLOUT_PHASE || "1");

// ── Phase definitions ─────────────────────────────────────────────────────
const PHASE_CONFIG = {
  1: {
    label: "Phase 1 — Pilot (Paper / North India)",
    description: "Limited pilot on Paper business line, North India region only. Surfaces workflow and SAP integration issues on a smaller blast radius before full rollout.",
    allowedBusinessLines: ["Paper"],
    allowedRegions:       ["North India", "North"],
    maxConcurrentComplaints: 50,
    sapMode: "mock",
    features: {
      slaEngine:        true,
      notifications:    true,
      rbac:             true,
      kpiDashboard:     true,
      archival:         false,  // Not yet in pilot
      repeatDetection:  true,
    },
  },
  2: {
    label: "Phase 2 — Extended (Paper All Regions + Chemical North India)",
    description: "Paper expanded to all regions. Chemical limited to North India pilot.",
    allowedBusinessLines: ["Paper", "Chemical"],
    allowedRegions:       ["North India", "North", "South India", "South", "East India", "East", "West India", "West"],
    maxConcurrentComplaints: 200,
    sapMode: "mock",
    features: {
      slaEngine:        true,
      notifications:    true,
      rbac:             true,
      kpiDashboard:     true,
      archival:         true,
      repeatDetection:  true,
    },
  },
  3: {
    label: "Phase 3 — Full Rollout (All Business Lines & Regions)",
    description: "Full production rollout. All business lines and regions enabled. Live SAP connection recommended.",
    allowedBusinessLines: ["Paper", "Chemical"],
    allowedRegions:       "*",  // All regions
    maxConcurrentComplaints: null,  // No limit
    sapMode: "live",
    features: {
      slaEngine:        true,
      notifications:    true,
      rbac:             true,
      kpiDashboard:     true,
      archival:         true,
      repeatDetection:  true,
    },
  },
};

const currentPhase = PHASE_CONFIG[ROLLOUT_PHASE] || PHASE_CONFIG[1];

// ── Region normalisation ──────────────────────────────────────────────────
// Region names reach us from SAP customer master, where the wording is not
// controlled: "Northern India", "North India" and "North" all name the same
// pilot region. Comparing the raw strings meant the gate matched on spelling
// rather than meaning — every real customer fell outside every phase. Reduce
// both sides to a bare direction before comparing.
const REGION_ALIASES = { northern: "north", southern: "south", eastern: "east", western: "west" };

function normalizeRegion(region) {
  if (!region) return null;
  const word = String(region).toLowerCase().replace(/india/g, "").replace(/[^a-z]/g, "");
  return REGION_ALIASES[word] || word || null;
}

// ── Gate checker ──────────────────────────────────────────────────────────
function checkRolloutGate(businessLine, region) {
  // Phase 3 = no restrictions
  if (ROLLOUT_PHASE >= 3) return { allowed: true, phase: ROLLOUT_PHASE };

  // Business line check
  if (!currentPhase.allowedBusinessLines.includes(businessLine)) {
    return {
      allowed: false,
      reason:  `Business line '${businessLine}' is not yet enabled in ${currentPhase.label}. Currently active: ${currentPhase.allowedBusinessLines.join(", ")}.`,
      phase:   ROLLOUT_PHASE,
      hint:    `Contact CCMS admin to escalate to a higher rollout phase.`,
    };
  }

  // Region check (if provided)
  if (region && currentPhase.allowedRegions !== "*") {
    const wanted = normalizeRegion(region);
    const regionAllowed = currentPhase.allowedRegions.some(
      (r) => normalizeRegion(r) === wanted
    );
    if (!regionAllowed) {
      return {
        allowed: false,
        reason:  `Region '${region}' is not yet enabled in ${currentPhase.label}. Currently active regions: ${currentPhase.allowedRegions.join(", ")}.`,
        phase:   ROLLOUT_PHASE,
        hint:    `Contact CCMS admin to escalate to a higher rollout phase.`,
      };
    }
  }

  return { allowed: true, phase: ROLLOUT_PHASE, label: currentPhase.label };
}

// ── Feature flag checker ──────────────────────────────────────────────────
function isFeatureEnabled(featureName) {
  return currentPhase.features[featureName] === true;
}

// ── Rollout status (for GET /api/rollout) ────────────────────────────────
function getRolloutStatus() {
  return {
    currentPhase:  ROLLOUT_PHASE,
    phaseLabel:    currentPhase.label,
    description:   currentPhase.description,
    allowedBusinessLines: currentPhase.allowedBusinessLines,
    allowedRegions:       currentPhase.allowedRegions,
    maxConcurrentComplaints: currentPhase.maxConcurrentComplaints,
    features:      currentPhase.features,
    allPhases: Object.entries(PHASE_CONFIG).map(([phase, config]) => ({
      phase:       parseInt(phase),
      label:       config.label,
      description: config.description,
      active:      parseInt(phase) === ROLLOUT_PHASE,
    })),
    howToAdvance: ROLLOUT_PHASE < 3
      ? `Set ROLLOUT_PHASE=${ROLLOUT_PHASE + 1} in .env and restart the server to advance to the next phase.`
      : "Full rollout complete.",
  };
}

module.exports = {
  checkRolloutGate,
  isFeatureEnabled,
  getRolloutStatus,
  currentPhase,
  ROLLOUT_PHASE,
};
