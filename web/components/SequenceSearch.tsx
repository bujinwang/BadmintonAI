"use client";

import { Select } from "@/components/ui";
import { MAX_SEQUENCE_LENGTH } from "@/lib/sequences";
import { SHOT_ORDER, type P } from "@/lib/types";

const PRESETS = [["lift", "smash", "block"], ["smash", "block"], ["short serve", "net shot"]];

export default function SequenceSearch({ sequence, starter, names, onChange }: {
  sequence: string[];
  starter: P | "";
  names: Record<P, string>;
  onChange: (sequence: string[], starter: P | "") => void;
}) {
  return (
    <section aria-label="Shot sequence search" className="card px-4 py-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-medium">Find a shot sequence</h3>
        {(sequence.length > 0 || starter !== "") && (
          <button type="button" onClick={() => onChange([], "")}
            className="text-[12px] text-mut underline underline-offset-4">Clear sequence</button>
        )}
      </div>
      <p className="text-[12px] text-mut max-w-2xl">
        Find consecutive shots anywhere in a rally, up to six shots long. First hitter applies only to the first shot.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {sequence.map((shot, index) => (
          <div key={index} className="flex items-end gap-1.5 min-w-0">
            <Select label={`Shot ${index + 1}`} value={shot} options={SHOT_ORDER}
              onChange={(value) => onChange(sequence.map((s, i) => i === index ? value : s), starter)} />
            <button type="button" aria-label={`Remove shot ${index + 1}`}
              onClick={() => onChange(sequence.filter((_, i) => i !== index), starter)}
              className="h-8 w-8 rounded-md border border-[var(--line)] text-mut hover:text-ink">×</button>
          </div>
        ))}
        <button type="button" disabled={sequence.length >= MAX_SEQUENCE_LENGTH}
          onClick={() => onChange([...sequence, "smash"], starter)}
          className="h-8 rounded-md border border-[var(--line)] px-3 text-[12px] text-ink disabled:opacity-40 disabled:cursor-not-allowed">
          Add shot
        </button>
        <label className="flex min-w-0 flex-col gap-1 sm:ml-auto">
          <span className="kicker">First hitter</span>
          <select aria-label="First hitter" value={starter}
            onChange={(event) => onChange(sequence, event.target.value as P | "")}
            className="max-w-full rounded-md border border-[var(--line)] bg-[var(--panel-solid)] px-2 py-1.5 text-[13px] text-ink">
            <option value="">Either player</option>
            <option value="A">{names.A}</option>
            <option value="B">{names.B}</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-mut">Try</span>
        {PRESETS.map((preset) => (
          <button key={preset.join(",")} type="button" onClick={() => onChange([...preset], starter)}
            className="rounded-md border border-[var(--line-soft)] px-2 py-1 text-mut hover:text-ink">
            {preset.join(" → ")}
          </button>
        ))}
      </div>
    </section>
  );
}
