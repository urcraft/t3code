import type { OrchestrationLatestTurn } from "@t3tools/contracts";
import type { PendantTarget } from "../threads/pendant-targets";

// The pendant shows a bounded summary; full replies and approval details stay in T3.
export const PENDANT_DISPLAY_MAX = 72;
export const PENDANT_SPEECH_MAX = 220;

export type PendantState =
  | "offline"
  | "idle"
  | "transferring"
  | "thinking"
  | "receiving"
  | "needs_input"
  | "complete"
  | "cancelled"
  | "error";
export type PendantExpression =
  | "neutral"
  | "thinking"
  | "confused"
  | "happy"
  | "concerned"
  | "sleepy";
export type PendantSoundCue = "attention_chirp" | "success_chirp" | "error_tone";

export type PendantResponse = {
  version: 1;
  requestId: string | null;
  target: Pick<PendantTarget, "environmentId" | "projectId" | "threadId" | "driver"> | null;
  sequence: number;
  state: PendantState;
  displayText: string;
  speechText: string | null;
  expression: PendantExpression;
  intensity: "gentle" | "normal";
  soundCue: PendantSoundCue | null;
  // True when the pendant text omits part of the reply; the phone has the rest.
  detailOnPhone: boolean;
};

export type PendantLifecycleInput = {
  connected: boolean;
  localError: string | null;
  submitted: boolean;
  turn: Pick<OrchestrationLatestTurn, "turnId" | "state"> | null;
  needsInput: boolean;
  // A stop was sent but T3 has not confirmed it; distinct from a confirmed "cancelled".
  stopRequested: boolean;
  reply: string;
};

// Only T3 lifecycle facts decide state; reply wording never changes it.
export function pendantState(input: PendantLifecycleInput): PendantState {
  if (!input.connected) return "offline";
  if (input.localError) return "error";
  if (!input.turn) return input.submitted ? "transferring" : "idle";
  if (input.needsInput) return "needs_input";
  if (input.turn.state === "interrupted") return "cancelled";
  if (input.turn.state === "error") return "error";
  if (input.turn.state === "completed") return "complete";
  return input.reply ? "receiving" : "thinking";
}

// Outcome phrases, not topic words: a reply that describes error handling is not a
// failed task, but "2 tests failed" or "I couldn't verify" must not earn a celebration.
const caveatOutcome =
  /\b(\d+\s+(\w+\s+)?(failed|failing|failures?|errors?)|tests?\s+(failed|failing|did not pass|didn't pass)|(build|check|lint|typecheck|compilation)\s+(failed|failing|is failing)|still (failing|broken)|could ?n[o']t|was unable|were unable|am unable|unable to (run|verify|test|finish|complete|build|reproduce)|not (yet )?(finished|done|completed?|implemented|verified|tested)|skipped|i'?m not sure|uncertain)\b/i;
const negatedCaveat = /\b(no|zero|0|without)\s+(\w+\s+)?(fail(ed|ures?|s)?|errors?)\b/gi;

// The deterministic fallback cannot judge tone; it only withholds celebration when a
// reply plainly reports an unfinished or failed outcome. Model summaries replace this.
export function hasCaveat(text: string): boolean {
  return caveatOutcome.test(text.replace(negatedCaveat, ""));
}

// Markdown and code are unreadable on a 466 px round display; keep prose only.
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// End a sentence only at punctuation followed by space, so "wordcount.py" stays whole.
function sentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1\u0000")
    .split("\u0000")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Whole sentences up to the budget; a single long sentence is cut at a word boundary.
export function boundedSummary(text: string, max: number): { text: string; truncated: boolean } {
  const plain = plainText(text);
  if (plain.length <= max) return { text: plain, truncated: false };
  let out = "";
  for (const sentence of sentences(plain)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (!out) {
    const cut = plain.slice(0, max - 1);
    out = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).trimEnd()}…`;
  }
  return { text: out, truncated: true };
}

// A caveat cut from a summary must still be signalled, not hidden behind a happy face.
function truthfulSummary(reply: string, max: number, note: string) {
  const summary = boundedSummary(reply, max);
  if (!hasCaveat(reply) || hasCaveat(summary.text)) return summary;
  return { text: `${boundedSummary(reply, max - note.length).text}${note}`, truncated: true };
}

const fixedText: Record<Exclude<PendantState, "complete" | "error">, string> = {
  offline: "T3 is offline.",
  idle: "Ready.",
  transferring: "Sending to your agent…",
  thinking: "Working on it…",
  receiving: "Writing a reply…",
  needs_input: "Check your phone. Your agent needs you.",
  cancelled: "Stopped.",
};

export function formatPendantResponse(
  input: PendantLifecycleInput & {
    requestId: string | null;
    target: PendantTarget | null;
    sequence: number;
    // False for a turn that finished before this companion watched it, e.g. when
    // opening an old conversation; its outcome is shown but not announced again.
    announce: boolean;
  },
): PendantResponse {
  const state = pendantState(input);
  let displayText: string;
  let speechText: string | null = null;
  let detailOnPhone = false;
  let expression: PendantExpression;
  let soundCue: PendantSoundCue | null = null;

  if (state === "complete") {
    const reply = plainText(input.reply);
    const caveat = hasCaveat(reply);
    const summary = truthfulSummary(reply, PENDANT_DISPLAY_MAX, " More on your phone.");
    const speech = truthfulSummary(
      reply,
      PENDANT_SPEECH_MAX,
      " Please check the details on your phone.",
    );
    displayText = reply ? summary.text : "Done. Details are on your phone.";
    speechText = reply ? speech.text : null;
    detailOnPhone = !reply || summary.truncated;
    expression = caveat ? "concerned" : "happy";
    soundCue = caveat || !input.announce ? null : "success_chirp";
  } else if (state === "error") {
    displayText = input.localError
      ? boundedSummary(input.localError, PENDANT_DISPLAY_MAX).text
      : "The turn failed. Details are on your phone.";
    detailOnPhone = true;
    expression = "concerned";
    soundCue = input.localError || input.announce ? "error_tone" : null;
  } else {
    displayText =
      input.stopRequested && (state === "thinking" || state === "receiving")
        ? "Stopping… waiting for your agent."
        : fixedText[state];
    detailOnPhone = state === "needs_input";
    expression =
      state === "offline"
        ? "sleepy"
        : state === "needs_input"
          ? "confused"
          : state === "transferring" || state === "thinking" || state === "receiving"
            ? "thinking"
            : "neutral";
    soundCue = state === "needs_input" ? "attention_chirp" : null;
  }

  return {
    version: 1,
    requestId: input.requestId,
    target: input.target
      ? {
          environmentId: input.target.environmentId,
          projectId: input.target.projectId,
          threadId: input.target.threadId,
          driver: input.target.driver,
        }
      : null,
    sequence: input.sequence,
    state,
    displayText,
    speechText,
    expression,
    intensity: state === "complete" || state === "needs_input" ? "normal" : "gentle",
    soundCue,
    detailOnPhone,
  };
}
