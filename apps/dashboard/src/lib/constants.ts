// Domain enums. Stored as strings in SQLite (Prisma enums need Postgres);
// these unions + maps are the single source of truth in app code.
// When we move to Postgres for production, these become real Prisma enums.

export const PROJECT_TYPES = ["WEBSITE", "LANDING_PAGE"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PLATFORMS = [
  "WORDPRESS",
  "WEBFLOW",
  "UNBOUNCE",
  "HUBSPOT",
  "PODIA",
  "GHL",
  "WIX",
  "KAJABI",
  "CLICKFUNNEL",
  "ELEMENTOR",
  "SWIPEPAGES",
  "LEARNWORLDS",
  "ASTRO",
  "FRAMER",
  "VERCEL",
  "RAILWAY",
  "RENDER",
  "OTHER",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STATUSES = ["IN_PROGRESS", "IN_QA", "LIVE"] as const;
export type Status = (typeof STATUSES)[number];

export const SEVERITIES = [
  "CRITICAL_HIGH",
  "MEDIUM",
  "LOW",
  "REPETITIVE",
] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_STATUSES = ["OPEN", "FIXED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

// Boards. Five stages, not three or four: each one says whose turn it is.
// COMPLETED ("the developer says it is fixed") and CLOSED ("QA confirmed")
// stay separate — that gap is what the metrics measure, and moving a card
// backward out of either is a rejection.
export const BOARD_STAGES = [
  "NEW",
  "ACTIVE",
  "NEEDS_CLARIFICATION",
  "COMPLETED",
  "CLOSED",
] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];
export const BOARD_STAGE_LABELS: Record<BoardStage, string> = {
  NEW: "New",
  ACTIVE: "Active",
  // The stored value stays NEEDS_CLARIFICATION — renaming an enum that
  // sits in a database column buys a migration for a word on a screen.
  NEEDS_CLARIFICATION: "Discussed",
  COMPLETED: "Completed",
  CLOSED: "Closed",
};

export const CHECK_RESULTS = ["PASSED", "FAILED", "NA"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const CERT_STATUSES = ["IN_PROGRESS", "PASS", "FAIL"] as const;
export type CertStatus = (typeof CERT_STATUSES)[number];

// The WORK someone does — what they can be assigned. MANAGER is for people
// who are on the team but take neither role (a CEO, a project manager): they
// hold a row for attribution and @mentions, and appear in no assignment list.
export const MEMBER_ROLES = ["DEVELOPER", "TESTER", "BOTH", "MANAGER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// Human labels
export const LABELS: Record<string, string> = {
  MANAGER: "Manager",
  WEBSITE: "Website",
  LANDING_PAGE: "Landing page",
  IN_PROGRESS: "In progress",
  IN_QA: "In QA",
  LIVE: "Live",
  CRITICAL_HIGH: "Critical / High",
  MEDIUM: "Medium",
  LOW: "Low",
  REPETITIVE: "Repetitive",
  OPEN: "Open",
  FIXED: "Fixed",
  PASSED: "Passed",
  FAILED: "Failed",
  NA: "N/A",
  PASS: "Pass",
  FAIL: "Fail",
  DEVELOPER: "Developer",
  TESTER: "Tester",
  BOTH: "Developer & Tester",
  WORDPRESS: "WordPress",
  WEBFLOW: "Webflow",
  UNBOUNCE: "Unbounce",
  HUBSPOT: "HubSpot",
  PODIA: "Podia",
  GHL: "GoHighLevel",
  WIX: "Wix",
  KAJABI: "Kajabi",
  CLICKFUNNEL: "ClickFunnels",
  ELEMENTOR: "Elementor",
  SWIPEPAGES: "Swipepages",
  LEARNWORLDS: "LearnWorlds",
  ASTRO: "Astro",
  FRAMER: "Framer",
  VERCEL: "Vercel",
  RAILWAY: "Railway",
  RENDER: "Render",
  OTHER: "Other",
};

export function label(value: string): string {
  return LABELS[value] ?? value;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-05" → "May 2026" */
export function monthLabel(ym: string): string {
  const [y, mo] = ym.split("-");
  return `${MONTH_NAMES[Number(mo) - 1] ?? mo} ${y}`;
}

export type Tone = "neutral" | "success" | "warning" | "error" | "info" | "brand";

export const STATUS_TONE: Record<Status, Tone> = {
  IN_PROGRESS: "warning",
  IN_QA: "info",
  LIVE: "success",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  CRITICAL_HIGH: "error",
  MEDIUM: "warning",
  LOW: "neutral",
  REPETITIVE: "brand",
};

export const CERT_TONE: Record<CertStatus, Tone> = {
  IN_PROGRESS: "warning",
  PASS: "success",
  FAIL: "error",
};

export const CHECK_TONE: Record<CheckResult, Tone> = {
  PASSED: "success",
  FAILED: "error",
  NA: "neutral",
};
