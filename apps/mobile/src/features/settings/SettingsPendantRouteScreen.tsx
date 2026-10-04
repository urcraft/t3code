import { useEffect, useState, type ComponentProps } from "react";
import { EnvironmentId } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { MaterialListRow } from "../../components/MaterialListRow";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { lastSeenLabel, pendantLinkLabel, usePendantCompanion } from "../pendant/pendant-companion";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

// Development-only until the native BLE module exists: the link is the browser simulator.
export function SettingsPendantRouteScreen() {
  const insets = useSafeAreaInsets();
  const { link, confirmed, latest } = usePendantCompanion();
  const runtime = useRemoteEnvironmentRuntime(
    confirmed ? EnvironmentId.make(confirmed.target.environmentId) : null,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const server = !confirmed
    ? "No server selected"
    : runtime?.connectionState === "connected"
      ? "Ready"
      : `Unavailable (${runtime?.connectionState ?? "not paired"})`;

  return (
    <SettingsScreen title="Pendant">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Pendant link">
          <InfoRow
            icon="bolt.horizontal.circle"
            label={pendantLinkLabel(link)}
            value={lastSeenLabel(link.lastSeenAt, now)}
          />
          <InfoRow icon="info.circle" label="Battery" value="Not reported by simulator" />
        </SettingsSection>

        <SettingsSection title="Conversation">
          <InfoRow icon="server.rack" label="Server" value={server} />
          <InfoRow
            icon="text.bubble"
            label={confirmed ? confirmed.title : "No conversation confirmed"}
            value={
              confirmed
                ? `${confirmed.environmentLabel} · ${confirmed.projectLabel} · ${confirmed.target.providerName} · ${confirmed.target.model}${confirmed.target.available ? "" : ` · ${confirmed.target.reason}`}`
                : "Open a conversation to route pendant requests to it."
            }
          />
          {latest ? (
            <InfoRow
              icon="checkmark.circle"
              label="Last pendant update"
              value={latest.displayText}
            />
          ) : null}
        </SettingsSection>

        <Text className="px-4 text-xs text-foreground-muted">
          This development build connects to the browser pendant simulator. Physical pendant pairing
          is not available yet. Full replies and approvals always stay in the T3 conversation.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}

// Read-only status: no chevron or button role, since nothing here navigates.
function InfoRow(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly label: string;
  readonly value: string;
}) {
  return (
    <MaterialListRow
      className="bg-grouped-card"
      accessibilityRole="text"
      title={props.label}
      subtitle={props.value}
      trailing={null}
      leading={<SymbolView name={props.icon} size={24} tintColorClassName="accent-icon" />}
    />
  );
}
