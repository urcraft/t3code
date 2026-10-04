import { describe, expect, it } from "vite-plus/test";
import {
  PENDANT_DISPLAY_MAX,
  PENDANT_SPEECH_MAX,
  boundedSummary,
  formatPendantResponse,
  hasCaveat,
  plainText,
} from "./pendant-response";

const base = {
  connected: true,
  localError: null,
  submitted: true,
  needsInput: false,
  stopRequested: false,
  reply: "",
  requestId: "turn-1",
  target: null,
  sequence: 1,
  announce: true,
};
const turn = (state: "running" | "completed" | "error" | "interrupted") =>
  ({ turnId: "turn-1", state }) as never;

describe("pendant response lifecycle", () => {
  it("takes state from T3 events, not from reply wording", () => {
    const failed = formatPendantResponse({
      ...base,
      turn: turn("error"),
      reply: "Done! Everything passed perfectly.",
    });
    expect(failed.state).toBe("error");
    expect(failed.expression).toBe("concerned");
    expect(failed.soundCue).toBe("error_tone");
    expect(failed.displayText).not.toMatch(/passed/);
  });

  it("orders offline, local error and needs-input ahead of turn state", () => {
    expect(
      formatPendantResponse({ ...base, connected: false, turn: turn("completed") }).state,
    ).toBe("offline");
    expect(
      formatPendantResponse({ ...base, localError: "Stale target", turn: turn("completed") }).state,
    ).toBe("error");
    expect(formatPendantResponse({ ...base, needsInput: true, turn: turn("running") }).state).toBe(
      "needs_input",
    );
    expect(formatPendantResponse({ ...base, turn: null }).state).toBe("transferring");
    expect(formatPendantResponse({ ...base, submitted: false, turn: null }).state).toBe("idle");
    expect(formatPendantResponse({ ...base, turn: turn("interrupted") }).soundCue).toBeNull();
  });

  it("distinguishes a requested stop from a confirmed one", () => {
    const requested = formatPendantResponse({
      ...base,
      stopRequested: true,
      turn: turn("running"),
    });
    expect(requested.state).toBe("thinking");
    expect(requested.displayText).toMatch(/^Stopping/);
    const confirmed = formatPendantResponse({
      ...base,
      stopRequested: true,
      turn: turn("interrupted"),
    });
    expect(confirmed.state).toBe("cancelled");
    expect(confirmed.displayText).toBe("Stopped.");
    expect(confirmed.soundCue).toBeNull();
  });

  it("points to the phone for approvals without summarising their details", () => {
    const update = formatPendantResponse({
      ...base,
      needsInput: true,
      turn: turn("running"),
      reply: "I need to run rm -rf build to continue.",
    });
    expect(update.displayText).toBe("Check your phone. Your agent needs you.");
    expect(update.soundCue).toBe("attention_chirp");
    expect(update.detailOnPhone).toBe(true);
  });
});

describe("pendant completion summaries", () => {
  it("celebrates only clean completions", () => {
    const ok = formatPendantResponse({
      ...base,
      turn: turn("completed"),
      reply: "Added word counting. All 3 tests passed with no errors.",
    });
    expect(ok.expression).toBe("happy");
    expect(ok.soundCue).toBe("success_chirp");
    expect(ok.displayText).toBe("Added word counting. All 3 tests passed with no errors.");
  });

  it("keeps a truncated caveat visible and withholds the success cue", () => {
    const reply = `Added the parser and wired it into the command line entry point for every subcommand. ${"Updated docs. ".repeat(4)}Two tests failed on Windows paths.`;
    const update = formatPendantResponse({ ...base, turn: turn("completed"), reply });
    expect(update.state).toBe("complete");
    expect(update.expression).toBe("concerned");
    expect(update.soundCue).toBeNull();
    expect(update.displayText).toMatch(/More on your phone.$/);
    expect(update.displayText.length).toBeLessThanOrEqual(PENDANT_DISPLAY_MAX);
    expect(update.detailOnPhone).toBe(true);
  });

  it("does not re-announce an outcome it did not watch", () => {
    const old = { ...base, announce: false, reply: "All good." };
    expect(formatPendantResponse({ ...old, turn: turn("completed") }).soundCue).toBeNull();
    expect(formatPendantResponse({ ...old, turn: turn("completed") }).expression).toBe("happy");
    expect(formatPendantResponse({ ...old, turn: turn("error") }).soundCue).toBeNull();
    expect(formatPendantResponse({ ...old, localError: "Stale target", turn: null }).soundCue).toBe(
      "error_tone",
    );
  });

  it("bounds display and speech text", () => {
    const reply = "This sentence is short. ".repeat(30);
    const update = formatPendantResponse({ ...base, turn: turn("completed"), reply });
    expect(update.displayText.length).toBeLessThanOrEqual(PENDANT_DISPLAY_MAX);
    expect(update.speechText!.length).toBeLessThanOrEqual(PENDANT_SPEECH_MAX);
    expect(boundedSummary("a".repeat(200), 40).text.length).toBeLessThanOrEqual(40);
  });

  it("strips markdown and code before summarising", () => {
    expect(
      plainText("## Done\n- Added `wordcount.py`\n```py\nprint(1)\n```\nSee [README](x)."),
    ).toBe("Done Added wordcount.py See README.");
  });

  it("does not mistake a description of error handling for a failed task", () => {
    // Live Claude reply from the 2026-10-04 emulator run.
    const reply =
      "`wordcount.py` takes one file path as a command-line argument, reads the file, and prints the number of whitespace-separated words in it. If the file is missing, it prints a clear error to stderr (`error: file not found: <path>`) and exits with status 1. Calling it with no argument prints a usage message and exits with status 2.";
    const update = formatPendantResponse({ ...base, turn: turn("completed"), reply });
    expect(update.expression).toBe("happy");
    expect(update.soundCue).toBe("success_chirp");
    expect(update.speechText).toMatch(/^wordcount\.py takes one file path/);
    expect(update.displayText).toMatch(/^wordcount\.py takes/);
    expect(update.displayText.length).toBeLessThanOrEqual(PENDANT_DISPLAY_MAX);
  });

  it("treats negated failures as clean", () => {
    expect(hasCaveat("0 failed, no errors, without warnings")).toBe(false);
    expect(hasCaveat("1 test failed")).toBe(true);
    expect(hasCaveat("I could not verify the build")).toBe(true);
  });
});
