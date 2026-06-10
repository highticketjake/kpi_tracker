// Small shared UI primitives, iOS-flavored like v1 (light grays, rounded cards).

export function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="font-display text-2xl tracking-wide text-gray-800">{children}</h2>
      {right}
    </div>
  );
}

export function Btn({ children, onClick, kind = "primary", disabled, type = "button", className = "" }) {
  const styles = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    subtle: "bg-gray-100 text-gray-700 hover:bg-gray-200",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition disabled:opacity-40 ${styles[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`border border-gray-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 ${props.className || ""}`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className={`border border-gray-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 ${props.className || ""}`}
    >
      {children}
    </select>
  );
}

export function Badge({ color, bg, children }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ color, background: bg }}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="text-center px-3 py-2">
      <div className="text-xl font-bold text-gray-800">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      {sub ? <div className="text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-gray-400">
      <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2 my-2">{String(children)}</div>;
}
