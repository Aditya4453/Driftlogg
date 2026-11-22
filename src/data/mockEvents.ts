import type { ActivityEvent } from "../types"

export const initialEvents: ActivityEvent[] = [
  {
    time: "8m",

    title: "Scan completed",

    detail: "core-platform · 4 high-risk signals",

    tone: "coral",
  },

  {
    time: "1h",

    title: "Risk score improved",

    detail: "checkout-service · 76 → 81",

    tone: "lime",
  },

  {
    time: "Yesterday",

    title: "Manifest uploaded",

    detail: "admin-console · 214 packages",

    tone: "violet",
  },

  {
    time: "3d",

    title: "Package status changed",

    detail: "moment entered maintenance mode",

    tone: "amber",
  },
]
