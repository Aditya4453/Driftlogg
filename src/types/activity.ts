export type ActivityTone = "coral" | "lime" | "violet" | "amber"

export interface ActivityEvent {
  time: string
  title: string
  detail: string
  tone: ActivityTone
}
