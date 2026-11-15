import { User } from "./User.js"
import { Workspace } from "./Workspace.js"
import { Membership } from "./Membership.js"
import { Project } from "./Project.js"
import { Scan } from "./Scan.js"
import { Dependency } from "./Dependency.js"
import { RiskReport } from "./RiskReport.js"

export { User, Workspace, Membership, Project, Scan, Dependency, RiskReport }

// Order matters only for readability in logs; indexes are created for each model.
export const models = [User, Workspace, Membership, Project, Scan, Dependency, RiskReport]
