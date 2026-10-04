import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { OrchestrationLatestTurn, OrchestrationMessage } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ProviderIcon } from "../../components/ProviderIcon";
import {
  pendantLinkLabel,
  pendantSimulatorEnabled as enabled,
  pendantSimulatorOrigin as origin,
  setPendantConfirmed,
  setPendantLatest,
  usePendantCompanion,
} from "../pendant/pendant-companion";
import {
  formatPendantResponse,
  pendantState,
  type PendantResponse,
} from "../pendant/pendant-response";
import { validatePendantCommand, type PendantTarget } from "./pendant-targets";

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

// Clock-based so a JS reload never reuses a sequence the simulator already accepted.
let lastSequence = 0;
function nextSequence() {
  lastSequence = Math.max(lastSequence + 1, Date.now());
  return lastSequence;
}

// Detailed phone-side status; the pendant receives the bounded contract payload.
const statusText: Record<PendantResponse["state"], string> = {
  offline: "T3 connection is offline",
  error: "The T3 turn failed",
  idle: "Ready for a typed prompt",
  transferring: "Prompt queued in T3; waiting for a turn",
  needs_input: "Action needed in the T3 app",
  cancelled: "T3 confirmed the turn stopped",
  complete: "T3 completed the turn",
  receiving: "Receiving the agent reply",
  thinking: "Agent working",
};

// This bridge is deliberately restricted to the Android emulator and the open thread.
// The simulator is a dev input surface, not a BLE or microphone implementation.
export function PendantSimulatorBridge(props: Props) {
  const focused = useIsFocused();
  const latestProps = useRef(props);
  latestProps.current = props;
  const [active, setActive] = useState<Active | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const liveTurns = useRef(new Set<string>());
  const published = useRef<{ key: string; sequence: number } | null>(null);

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
  const lifecycle = {
    connected: props.connected,
    localError,
    submitted: !!active,
    turn,
    needsInput: props.needsInput,
    stopRequested,
    reply: response,
    requestId: turn?.turnId ?? active?.commandId ?? null,
    target: props.target,
  };
  const state = pendantState(lifecycle);
  // Changes whenever the pendant payload would; heartbeats reuse its sequence.
  const key = JSON.stringify(formatPendantResponse({ ...lifecycle, announce: false, sequence: 0 }));
  const status =
    state === "error"
      ? (localError ?? statusText.error)
      : (state === "thinking" || state === "receiving") && stopRequested
        ? "Stop requested; waiting for T3 confirmation"
        : statusText[state];

  useEffect(() => {
    if (!enabled || !focused || !props.target) return;
    setPendantConfirmed({
      target: props.target,
      environmentLabel: props.environmentLabel,
      projectLabel: props.projectLabel,
      title: props.title,
    });
  }, [focused, props.target, props.environmentLabel, props.projectLabel, props.title]);

  useEffect(() => {
    if (!enabled || !focused) return;
    // Announce only turns seen running, or sent from the pendant, while watched.
    if (turn && (turn.state === "running" || active)) liveTurns.current.add(turn.turnId);
    const pendant = formatPendantResponse({
      ...lifecycle,
      announce: !!turn && liveTurns.current.has(turn.turnId),
      sequence: published.current?.key === key ? published.current.sequence : nextSequence(),
    });
    published.current = { key, sequence: pendant.sequence };
    setPendantLatest(pendant);
    const publish = () => {
      void post("/api/mobile/state", {
        state,
        status,
        response: response.slice(0, 2047),
        pendant,
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
    // `key` captures every pendant field; `lifecycle` is rebuilt each render.
  }, [
    key,
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

  if (!enabled) return null;
  return <PendantCard connected={props.connected} target={props.target} />;
}

// Pendant link and T3 server readiness are independent facts; show both.
function PendantCard(props: { connected: boolean; target: PendantTarget | null }) {
  const navigation = useNavigation();
  const { link } = usePendantCompanion();
  const agent = props.target
    ? `${props.target.providerName} · ${props.target.model}`
    : "No conversation confirmed";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pendantLinkLabel(link)}. Server ${props.connected ? "ready" : "unavailable"}. ${agent}. Open pendant settings.`}
      className="mx-3 mb-2 min-h-11 flex-row items-center gap-3 rounded-2xl bg-grouped-card px-3 py-2"
      onPress={() =>
        navigation.navigate("SettingsSheet", {
          screen: "SettingsContent",
          params: { screen: "SettingsPendant" },
        })
      }
    >
      <ProviderIcon provider={props.target?.driver} size={18} />
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-t3-medium" numberOfLines={1}>
          {pendantLinkLabel(link)}
          <Text className="text-xs text-foreground-muted">
            {" · "}
            {props.connected ? "Server ready" : "Server unavailable"}
          </Text>
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {agent}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={16} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}
