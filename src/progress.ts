type ProgressTick = {
  stored?: number;
  duplicates?: number;
  connections?: number;
};

type ProgressBarOptions = {
  total: number;
  fallbackEvery?: number;
  minColumns?: number;
};

export type ProgressSummary = {
  stored: number;
  duplicates: number;
  connections: number;
};

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0';
  return value.toFixed(1);
}

export class ProgressBar {
  private readonly total: number;
  private readonly fallbackEvery: number;
  private readonly minColumns: number;
  private readonly startedAtMs: number;
  private readonly completionTimesMs: number[] = [];
  private rendered = false;

  private completed = 0;
  private stored = 0;
  private duplicates = 0;
  private connections = 0;

  constructor(options: ProgressBarOptions) {
    this.total = Math.max(0, options.total);
    this.fallbackEvery = options.fallbackEvery ?? 50;
    this.minColumns = options.minColumns ?? 60;
    this.startedAtMs = Date.now();
  }

  private get isInteractive(): boolean {
    const columns = process.stdout.columns ?? 0;
    return Boolean(process.stdout.isTTY) && columns >= this.minColumns;
  }

  private renderLine(line: string): string {
    const columns = process.stdout.columns;
    if (!columns || columns <= 0) return line;
    if (line.length <= columns) return line;
    return line.slice(0, Math.max(1, columns - 1));
  }

  private getRollingRatePerSecond(): number {
    if (this.completionTimesMs.length < 2) {
      const elapsedSeconds = (Date.now() - this.startedAtMs) / 1000;
      return elapsedSeconds > 0 ? this.completed / elapsedSeconds : 0;
    }

    const first = this.completionTimesMs[0];
    const last = this.completionTimesMs[this.completionTimesMs.length - 1];
    const deltaSeconds = (last - first) / 1000;
    if (deltaSeconds <= 0) return 0;
    return (this.completionTimesMs.length - 1) / deltaSeconds;
  }

  private renderInteractive(): void {
    const width = 32;
    const ratio = this.total === 0 ? 1 : this.completed / this.total;
    const bounded = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(bounded * width);
    const empty = width - filled;
    const percent = Math.round(bounded * 100);

    const rate = this.getRollingRatePerSecond();
    const remaining = Math.max(0, this.total - this.completed);
    const etaSeconds = rate > 0 ? remaining / rate : 0;

    const line1 = this.renderLine(
      `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${this.completed}/${this.total}  ${percent}%  ●  ${formatRate(rate)} chunks/sec  ETA ${formatDuration(etaSeconds)}`
    );
    const line2 = this.renderLine(
      `✓ stored ${this.stored}  ⊘ ${this.duplicates} dupes  ⟳ ${this.connections} connections`
    );

    if (!this.rendered) {
      process.stdout.write(`${line1}\n${line2}`);
      this.rendered = true;
      return;
    }

    process.stdout.write(`\x1b[1A\r\x1b[2K${line1}\n\x1b[2K${line2}`);
  }

  private renderFallback(): void {
    if (this.completed !== this.total && this.completed % this.fallbackEvery !== 0) {
      return;
    }

    const rate = this.getRollingRatePerSecond();
    const remaining = Math.max(0, this.total - this.completed);
    const etaSeconds = rate > 0 ? remaining / rate : 0;
    const percent = this.total === 0 ? 100 : Math.round((this.completed / this.total) * 100);

    console.log(
      `Progress ${this.completed}/${this.total} (${percent}%) - stored ${this.stored}, dupes ${this.duplicates}, connections ${this.connections}, ${formatRate(rate)} chunks/sec, ETA ${formatDuration(etaSeconds)}`
    );
  }

  tick(delta: ProgressTick): void {
    this.completed++;
    this.stored += delta.stored ?? 0;
    this.duplicates += delta.duplicates ?? 0;
    this.connections += delta.connections ?? 0;

    this.completionTimesMs.push(Date.now());
    if (this.completionTimesMs.length > 10) {
      this.completionTimesMs.shift();
    }

    if (this.isInteractive) {
      this.renderInteractive();
      return;
    }

    this.renderFallback();
  }

  finish(summary?: Partial<ProgressSummary>): ProgressSummary & { duration: string; durationSeconds: number } {
    if (summary) {
      if (typeof summary.stored === 'number') this.stored = summary.stored;
      if (typeof summary.duplicates === 'number') this.duplicates = summary.duplicates;
      if (typeof summary.connections === 'number') this.connections = summary.connections;
    }

    const durationSeconds = (Date.now() - this.startedAtMs) / 1000;
    const duration = formatDuration(durationSeconds);

    if (this.isInteractive && this.rendered) {
      process.stdout.write('\n');
    }

    return {
      stored: this.stored,
      duplicates: this.duplicates,
      connections: this.connections,
      duration,
      durationSeconds,
    };
  }
}
