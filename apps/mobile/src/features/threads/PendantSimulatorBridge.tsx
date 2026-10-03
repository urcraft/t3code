import { useEffect, useRef, useState } from "react";
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { OrchestrationLatestTurn, OrchestrationMessage } from "@t3tools/contracts";
import { useIsFocused } from "@react-navigation/native";
import { validatePendantCommand, type PendantTarget } from "./pendant-targets";

const origin = "http://127.0.0.1:8766";
const enabled = __DEV__ && Platform.OS === "android" && !Device.isDevice;

type Command = { id: string; environmentId: string; threadId: string } & (
  | { type: "send"; text: string }
  | { type: "cancel" }
  | { type: "select"; targetThreadId: string }
);
type Active = { baselineTurnId: string | null; commandId: string };

type Props = {
  environmentId: string;
  environmentLabel: string;
  projectLabel: string;
  target: PendantTarget | null;
  targets: ReadonlyArray<PendantTarget>;
  onSelectThread: (threadId: string) => void;
  threadId: string;
  title: string;
  latestTurn: OrchestrationLatestTurn | null;
  messages: ReadonlyArray<OrchestrationMessage>;
  needsInput: boolean;
  connected: boolean;
  onChangeDraftMessage: (text: string) => void;
  onSendMessage: () => Promise<unknown>;
  onStopThread: () => unknown;
};

async function post(path: string, body: object) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Simulator bridge returned ${response.status}`);
}

// This bridge is deliberately restricted to the Android emulator and the open thread.
// The simulator is a dev input surface, not a BLE or microphone implementation.
export function PendantSimulatorBridge(props: Props) {
  const focused = useIsFocused();
  const latestProps = useRef(props);
  latestProps.current = props;
  const [active, setActive] = useState<Active | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);

  useEffect(() => {
    setActive(null);
    setLocalError(null);
    setStopRequested(false);
  }, [props.threadId]);

  useEffect(() => {
    if (!enabled || !focused) return;
    let mounted = true;
    async function poll() {
      while (mounted) {
        try {
          const response = await fetch(`${origin}/api/mobile/commands`);
          if (!response.ok) throw new Error("Simulator unavailable");
          const payload = (await response.json()) as { commands: Command[] };
          for (const command of payload.commands) {
            if (!mounted) break;
            // Acknowledge first so a reload or slow composer cannot submit twice.
            await post("/api/mobile/ack", { id: command.id });
            const current = latestProps.current;
            const invalid = !current.connected
              ? "T3 is offline"
              : validatePendantCommand(command, {
                  environmentId: current.environmentId,
                  threadId: current.threadId,
                  busy: current.latestTurn?.state === "running",
                  available: current.target?.available ?? false,
                  targets: current.targets,
                });
            if (invalid) {
              setLocalError(invalid);
              continue;
            }
            if (command.type === "select") {
              setLocalError(null);
              current.onSelectThread(command.targetThreadId);
              break;
            }
            if (command.type === "send") {
              setLocalError(null);
              setStopRequested(false);
              setActive({
                baselineTurnId: current.latestTurn?.turnId ?? null,
                commandId: command.id,
              });
              try {
                current.onChangeDraftMessage(command.text);
                const messageId = await current.onSendMessage();
                if (messageId === null) throw new Error("T3 did not accept this prompt");
              } catch (error) {
                setLocalError(error instanceof Error ? error.message : "Prompt submission failed");
              }
            } else {
              setStopRequested(true);
              try {
                await current.onStopThread();
              } catch (error) {
                setLocalError(error instanceof Error ? error.message : "Stop request failed");
              }
            }
          }
        } catch {
          // The bridge is optional; the normal T3 thread remains usable.
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    void poll();
    return () => {
      mounted = false;
    };
  }, [focused]);

  const turn =
    active && props.latestTurn?.turnId === active.baselineTurnId ? null : props.latestTurn;
  const response = turn
    ? props.messages
        .filter((message) => message.role === "assistant" && message.turnId === turn.turnId)
        .map((message) => message.text)
        .join("\n")
    : "";
  const state = !props.connected
    ? "offline"
    : localError
      ? "error"
      : !active && !turn
        ? "idle"
        : !turn
          ? "transferring"
          : props.needsInput
            ? "needs_input"
            : turn.state === "interrupted"
              ? "cancelled"
              : turn.state === "error"
                ? "error"
                : turn.state === "completed"
                  ? "complete"
                  : response
                    ? "receiving"
                    : "thinking";
  const status =
    state === "offline"
      ? "T3 connection is offline"
      : state === "error"
        ? (localError ?? "The T3 turn failed")
        : state === "idle"
          ? "Ready for a typed prompt"
          : state === "transferring"
            ? "Prompt queued in T3; waiting for a turn"
            : state === "needs_input"
              ? "Action needed in the T3 app"
              : state === "cancelled"
                ? "T3 confirmed the turn stopped"
                : state === "complete"
                  ? "T3 completed the turn"
                  : stopRequested
                    ? "Stop requested; waiting for T3 confirmation"
                    : state === "receiving"
                      ? "Receiving the agent reply"
                      : "Agent working";

  useEffect(() => {
    if (!enabled || !focused) return;
    const publish = () => {
      void post("/api/mobile/state", {
        state,
        status,
        response: response.slice(0, 2047),
        thread: props.title,
        target: props.target,
        targets: props.targets,
        environmentLabel: props.environmentLabel,
        projectLabel: props.projectLabel,
        busy: props.latestTurn?.state === "running" || (!!active && !turn && !localError),
      }).catch(() => {});
    };
    publish();
    const heartbeat = setInterval(publish, 2000);
    return () => clearInterval(heartbeat);
  }, [
    state,
    status,
    response,
    props.title,
    props.target,
    props.targets,
    props.environmentLabel,
    props.projectLabel,
    props.latestTurn,
    active,
    turn,
    localError,
    focused,
  ]);

  return null;
}
