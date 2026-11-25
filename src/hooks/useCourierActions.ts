import { useCallback, useState } from 'react';
import { useCourierApp } from '../context/CourierAppContext';
import type { MissionStatus, ProofSubmission } from '../types/delivery';

/**
 * Hook métier centralisant les actions livreur (UI -> Hooks -> Services -> Edge Functions).
 */
export function useCourierActions() {
  const {
    mode,
    backendConnected,
    transitionMission,
    refreshBackendData,
    toggleAvailability,
  } = useCourierApp();

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const executeTransition = useCallback(
    async (
      missionId: string,
      nextStatus: MissionStatus,
      options?: { proof?: ProofSubmission; failureReason?: string }
    ): Promise<boolean> => {
      setPendingAction(`${missionId}:${nextStatus}`);
      try {
        return await transitionMission(missionId, nextStatus, options);
      } finally {
        setPendingAction(null);
      }
    },
    [transitionMission]
  );

  return {
    mode,
    backendConnected,
    pendingAction,
    executeTransition,
    refreshBackendData,
    toggleAvailability,
  };
}
