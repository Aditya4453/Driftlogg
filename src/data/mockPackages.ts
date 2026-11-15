import type { PackageDependency } from "../types"

export const initialPackages: PackageDependency[] = [
  {
    name: "request",
    version: "2.88.2",
    score: 94,
    risk: "High",
    reasons: ["Inactive 4+ years", "Deprecated package"],
  },
  {
    name: "node-sass",
    version: "4.14.1",
    score: 86,
    risk: "High",
    reasons: ["Unmaintained", "3 security issues"],
  },
  {
    name: "event-stream",
    version: "3.3.6",
    score: 81,
    risk: "High",
    reasons: ["Suspicious ownership", "Inactive 5+ years"],
  },
  {
    name: "lodash",
    version: "4.17.20",
    score: 64,
    risk: "Medium",
    reasons: ["Known vulnerability"],
  },
  {
    name: "moment",
    version: "2.29.1",
    score: 52,
    risk: "Medium",
    reasons: ["Maintenance mode"],
  },
  {
    name: "express",
    version: "4.18.2",
    score: 18,
    risk: "Low",
    reasons: ["Healthy activity"],
  },
]
