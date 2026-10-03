import { describe, expect, it } from "vite-plus/test";
import { validatePendantCommand, type PendantTarget } from "./pendant-targets";

const target: PendantTarget = {
  environmentId: "pc",
  projectId: "project",
  threadId: "claude-thread",
  title: "Claude task",
  instanceId: "claude-instance",
  driver: "claudeAgent",
  providerName: "Claude",
  model: "model",
  available: true,
  reason: "",
};
const current = {
  environmentId: "pc",
  threadId: "codex-thread",
  busy: false,
  available: true,
  targets: [target],
};
const select = {
  type: "select",
  environmentId: "pc",
  threadId: "codex-thread",
  targetThreadId: "claude-thread",
};

describe("pendant conversation routing", () => {
  it("allows an explicit available conversation and rejects a missing target", () => {
    expect(validatePendantCommand(select, current)).toBeNull();
    expect(
      validatePendantCommand({ ...select, targetThreadId: "other-project" }, current),
    ).toContain("no longer available");
  });
  it("rejects a command created before the phone changed conversations or computers", () => {
    expect(validatePendantCommand(select, { ...current, threadId: "new-thread" })).toContain(
      "changed",
    );
    expect(validatePendantCommand(select, { ...current, environmentId: "work-pc" })).toContain(
      "changed",
    );
  });
  it("prevents switching or sending during a turn while allowing cancellation", () => {
    const busy = { ...current, busy: true };
    expect(validatePendantCommand(select, busy)).toContain("active turn");
    expect(validatePendantCommand({ ...select, type: "send" }, busy)).toContain("active turn");
    expect(validatePendantCommand({ ...select, type: "cancel" }, busy)).toBeNull();
  });
  it("does not fall back to another agent when the requested provider is unavailable", () => {
    expect(
      validatePendantCommand(select, {
        ...current,
        targets: [{ ...target, available: false, reason: "Sign in to Claude" }],
      }),
    ).toBe("Sign in to Claude");
    expect(
      validatePendantCommand({ ...select, type: "send" }, { ...current, available: false }),
    ).toContain("unavailable");
  });
});
