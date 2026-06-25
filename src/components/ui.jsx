// Shared primitives for the Performance Windows dark scoreboard theme.
import { Component } from "react";

export function Card({ children, className = "" }) {
  return <div className={`bg-pw-surface rounded-2xl border border-pw-line ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h2 className="font-extrabold text-2xl tracking-tight text-white uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function Btn({ children, onClick, kind = "primary", disabled, type = "button", className = "" }) {
  const styles = {
    primary: "bg-pw-red text-white hover:bg-[#d61e25] active:scale-95",
    subtle: "bg-pw-surface2 text-gray-200 hover:bg-pw-line active:scale-95",
    danger: "bg-pw-darkred/40 text-red-300 hover:bg-pw-darkred/60 active:scale-95",
    ghost: "bg-transparent text-pw-muted hover:text-white",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-xl text-sm font-bold transition disabled:opacity-40 ${styles[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`border border-pw-line rounded-xl px-3 py-2 text-sm bg-pw-black text-white placeholder-pw-muted focus:outline-none focus:ring-2 focus:ring-pw-red/50 ${props.className || ""}`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className={`border border-pw-line rounded-xl px-3 py-2 text-sm bg-pw-black text-white focus:outline-none focus:ring-2 focus:ring-pw-red/50 ${props.className || ""}`}
    >
      {children}
    </select>
  );
}

// Mobile-first numeric input: big +/- targets, tap the number to type.
export function Stepper({ label, value, onChange, step = 1 }) {
  const v = Number(value) || 0;
  return (
    <div className="bg-pw-black rounded-xl px-2 py-1.5 flex items-center gap-1 border border-pw-line">
      <span className="text-[11px] text-pw-muted flex-1 truncate pl-1">{label}</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(0, v - step))}
        className="w-9 h-9 rounded-lg bg-pw-surface2 text-white text-lg font-bold active:scale-90 transition shrink-0"
      >
        −
      </button>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
        }}
        className="w-12 text-center bg-transparent text-white text-base font-bold focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(v + step)}
        className="w-9 h-9 rounded-lg bg-pw-surface2 text-white text-lg font-bold active:scale-90 transition shrink-0"
      >
        +
      </button>
    </div>
  );
}

export function Badge({ color = "#F6C444", bg = "rgba(246,196,68,0.12)", children, className = "" }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${className}`} style={{ color, background: bg }}>
      {children}
    </span>
  );
}

export function HoursChip({ hours, standard = 5 }) {
  const h = Number(hours) || 0;
  const full = h >= standard;
  return (
    <Badge color={full ? "#B8D576" : "#F6C444"} bg={full ? "rgba(16,141,7,0.18)" : "rgba(246,196,68,0.12)"}>
      {h.toFixed(1)} hrs {full ? "· full day" : ""}
    </Badge>
  );
}

export function Stat({ label, value, accent }) {
  return (
    <div className="bg-pw-surface rounded-xl border border-pw-line px-3 py-2.5 text-center">
      <div className={`text-2xl font-extrabold ${accent ? "text-pw-red" : "text-white"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-pw-muted mt-0.5">{label}</div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-pw-muted">
      <div className="w-4 h-4 border-2 border-pw-line border-t-pw-red rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="text-sm text-red-300 bg-pw-darkred/30 rounded-xl px-3 py-2 my-2">{String(children)}</div>;
}

// Catches render-time crashes so one bad value can never blank the whole app.
// Wrap per-tab (keyed by tab) so switching tabs clears a stuck error.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("UI crash caught by ErrorBoundary:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center p-6">
          <Card className="max-w-md p-6 text-center">
            <h2 className="font-extrabold text-xl uppercase text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-pw-muted mb-4">
              This screen hit an error — your data is safe. Reload to continue.
            </p>
            <Btn onClick={() => window.location.reload()}>Reload</Btn>
            <p className="text-[10px] text-pw-muted mt-3 break-words">
              {String(this.state.error?.message || this.state.error)}
            </p>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
