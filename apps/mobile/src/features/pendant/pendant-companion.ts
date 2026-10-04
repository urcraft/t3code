import { useSyncExternalStore } from "react";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { PendantTarget } from "../threads/pendant-targets";
import type { PendantResponse } from "./pendant-response";

// Only the Android emulator dev build talks to the browser simulator. There is no
// physical BLE link yet, so every link shown here is labelled as simulated.
export const pendantSimulatorEnabled = __DEV__ && Platform.OS === "android" && !Device.isDevice;
export const pendantSimulatorOrigin = "http://127.0.0.1:8766";

export type PendantLink = {
  kind: "simulated";
  status: "checking" | "connected" | "disconnected";
  lastSeenAt: number | null;
};

export type PendantCompanionState = {
  link: PendantLink;
  // Last conversation the phone confirmed for pendant routing.
  confirmed: {
    target: PendantTarget;
    environmentLabel: string;
    projectLabel: string;
    title: string;
  } | null;
  latest: PendantResponse | null;
};

let state: PendantCompanionState = {
  link: { kind: "simulated", status: "checking", lastSeenAt: null },
  confirmed: null,
  latest: null,
};
const listeners = new Set<() => void>();
let poller: ReturnType<typeof setInterval> | null = null;

function set(next: Partial<PendantCompanionState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function setPendantConfirmed(confirmed: PendantCompanionState["confirmed"]) {
  const current = state.confirmed;
  if (
    current?.target.threadId === confirmed?.target.threadId &&
    current?.target.available === confirmed?.target.available &&
    current?.title === confirmed?.title &&
    current?.target.model === confirmed?.target.model
  )
    return;
  set({ confirmed });
}

export function setPendantLatest(latest: PendantResponse) {
  set({ latest });
}

async function checkPresence() {
  try {
    const response = await fetch(`${pendantSimulatorOrigin}/api/pendant/presence`);
    if (!response.ok) throw new Error();
    // The simulator reports an age, so host/emulator clock skew cannot distort it.
    const body = (await response.json()) as { connected: boolean; ageMs: number | null };
    const status = body.connected ? "connected" : "disconnected";
    const lastSeenAt = body.ageMs === null ? null : Date.now() - body.ageMs;
    set({ link: { kind: "simulated", status, lastSeenAt } });
  } catch {
    if (state.link.status !== "disconnected")
      set({ link: { ...state.link, status: "disconnected" } });
  }
}

// Presence is polled only while something on screen shows it.
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (pendantSimulatorEnabled && poller === null) {
    void checkPresence();
    poller = setInterval(checkPresence, 2000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && poller !== null) {
      clearInterval(poller);
      poller = null;
    }
  };
}

export function usePendantCompanion(): PendantCompanionState {
  return useSyncExternalStore(subscribe, () => state);
}

export function pendantLinkLabel(link: PendantLink): string {
  return link.status === "connected"
    ? "Simulated pendant connected"
    : link.status === "checking"
      ? "Checking simulated pendant…"
      : "Simulated pendant disconnected";
}

export function lastSeenLabel(lastSeenAt: number | null, now: number): string {
  if (lastSeenAt === null) return "Never seen";
  const seconds = Math.max(0, Math.round((now - lastSeenAt) / 1000));
  return seconds < 5
    ? "Seen just now"
    : seconds < 60
      ? `Seen ${seconds}s ago`
      : `Seen ${Math.round(seconds / 60)} min ago`;
}
