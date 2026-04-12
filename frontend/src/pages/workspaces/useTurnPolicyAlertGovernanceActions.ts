import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  readRuntimePreferences,
  writeRuntimePreferences,
} from "../../features/settings/api";
import { getErrorMessage } from "../../lib/error-utils";
import type { RuntimePreferencesResult } from "../../types/api";
import {
  buildTurnPolicyAlertGovernancePayload,
  type TurnPolicyAlertGovernanceAction,
} from "../settings/configSettingsPageRuntimePreferences";

export type UseTurnPolicyAlertGovernanceActionsResult = {
  applyAlertGovernanceAction: (action: TurnPolicyAlertGovernanceAction) => void;
  applyAlertGovernanceActionAsync: (
    action: TurnPolicyAlertGovernanceAction,
  ) => Promise<RuntimePreferencesResult>;
  error: string | null;
  isPending: boolean;
  pendingAction?: TurnPolicyAlertGovernanceAction;
};

export function useTurnPolicyAlertGovernanceActions(options?: {
  source?: string;
}): UseTurnPolicyAlertGovernanceActionsResult {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (action: TurnPolicyAlertGovernanceAction) => {
      const runtimePreferences = await queryClient.ensureQueryData({
        queryKey: ["settings-runtime-preferences"],
        queryFn: readRuntimePreferences,
      });

      return writeRuntimePreferences(
        buildTurnPolicyAlertGovernancePayload(runtimePreferences, {
          ...action,
          source: action.source ?? options?.source,
        }),
      );
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["settings-runtime-preferences"], result);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-runtime-preferences"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["turn-policy-metrics"],
        }),
      ]);
    },
  });

  return {
    applyAlertGovernanceAction: mutation.mutate,
    applyAlertGovernanceActionAsync: mutation.mutateAsync,
    error: mutation.error ? getErrorMessage(mutation.error) : null,
    isPending: mutation.isPending,
    pendingAction: mutation.variables,
  };
}
