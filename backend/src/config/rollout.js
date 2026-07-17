















require("dotenv").config();

const ROLLOUT_PHASE = parseInt(process.env.ROLLOUT_PHASE || "1");


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
      archival:         false,
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
    allowedRegions:       "*",
    maxConcurrentComplaints: null,
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







const REGION_ALIASES = { northern: "north", southern: "south", eastern: "east", western: "west" };

function normalizeRegion(region) {
  if (!region) return null;
  const word = String(region).toLowerCase().replace(/india/g, "").replace(/[^a-z]/g, "");
  return REGION_ALIASES[word] || word || null;
}


function checkRolloutGate(businessLine, region) {

  if (ROLLOUT_PHASE >= 3) return { allowed: true, phase: ROLLOUT_PHASE };


  if (!currentPhase.allowedBusinessLines.includes(businessLine)) {
    return {
      allowed: false,
      reason:  `Business line '${businessLine}' is not yet enabled in ${currentPhase.label}. Currently active: ${currentPhase.allowedBusinessLines.join(", ")}.`,
      phase:   ROLLOUT_PHASE,
      hint:    `Contact CCMS admin to escalate to a higher rollout phase.`,
    };
  }


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


function isFeatureEnabled(featureName) {
  return currentPhase.features[featureName] === true;
}


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
