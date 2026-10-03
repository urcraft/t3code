import type { OrchestrationThreadShell, ServerProvider } from "@t3tools/contracts";

export type PendantTarget = {
  environmentId: string;
  projectId: string;
  threadId: string;
  title: string;
  instanceId: string;
  driver: string;
  providerName: string;
  model: string;
  available: boolean;
  reason: string;
};

// Resume explicit existing conversations; never change a conversation's provider implicitly.
export function pendantTargets(
  environmentId: string,
  projectId: string,
  threads: ReadonlyArray<OrchestrationThreadShell>,
  providers: ReadonlyArray<ServerProvider>,
): PendantTarget[] {
  return threads
    .filter((t) => t.projectId === projectId && t.archivedAt === null)
    .map((t) => {
      const p = providers.find((p) => p.instanceId === t.modelSelection.instanceId);
      const available =
        !!p &&
        p.enabled &&
        p.installed &&
        p.availability !== "unavailable" &&
        p.status !== "error" &&
        p.status !== "disabled" &&
        p.auth.status !== "unauthenticated";
      return {
        environmentId,
        projectId,
        threadId: String(t.id),
        title: t.title,
        instanceId: String(t.modelSelection.instanceId),
        driver: p?.driver ?? "unknown",
        providerName: p?.displayName ?? p?.driver ?? String(t.modelSelection.instanceId),
        model: t.modelSelection.model,
        available,
        reason: available
          ? ""
          : (p?.unavailableReason ?? p?.message ?? "Provider unavailable in T3"),
      };
    });
}

export function validatePendantCommand(
  command: { environmentId: string; threadId: string; type: string; targetThreadId?: string },
  current: {
    environmentId: string;
    threadId: string;
    busy: boolean;
    available: boolean;
    targets: ReadonlyArray<PendantTarget>;
  },
): string | null {
  if (command.environmentId !== current.environmentId || command.threadId !== current.threadId) {
    return "The active T3 conversation changed. Select it again before sending.";
  }
  if (command.type !== "cancel" && current.busy)
    return "Wait for the active turn or cancel it first.";
  if (command.type === "select") {
    const target = current.targets.find((t) => t.threadId === command.targetThreadId);
    if (!target?.available) return target?.reason || "That conversation is no longer available.";
  } else if (command.type === "send" && !current.available)
    return "The selected provider is unavailable.";
  return null;
}
