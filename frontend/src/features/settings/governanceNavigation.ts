import { activateStoredTab } from "../../components/ui/Tabs";

export const GOVERNANCE_SETTINGS_PATH = "/settings/governance";
export const GOVERNANCE_SETTINGS_TAB_STORAGE_KEY = "settings-governance-tab";

export type GovernanceSettingsTab =
  | "overview"
  | "runtime"
  | "workspace"
  | "activity";

export function activateGovernanceSettingsTab(tab: GovernanceSettingsTab) {
  activateStoredTab(GOVERNANCE_SETTINGS_TAB_STORAGE_KEY, tab);
}
