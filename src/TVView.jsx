import { memo, useEffect, useState, useCallback } from "react";
import TVAutoScroll from "./TVAutoScroll.jsx";
import TVYouTubeAmbient from "./TVYouTubeAmbient.jsx";

function Header(p) {
  var dupOffice = p.marketName.trim().toLowerCase() === p.officeName.trim().toLowerCase();
  return (
    <header className="relative z-10 flex flex-shrink-0 flex-col gap-4 border-b border-white/[0.08] bg-black/30 px-5 py-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-4xl leading-none tracking-wide text-white sm:text-5xl">{p.marketName}</span>
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-tv text-xs font-bold uppercase tracking-widest text-emerald-300/90">
            {p.regionLabel}
          </span>
        </div>
        {!dupOffice ? <p className="mt-1 truncate font-tv text-lg font-semibold text-slate-400">{p.officeName}</p> : null}
        <p className="mt-1 font-tv text-sm text-slate-500">{p.rangeLabel}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4">
        <div
          className="flex rounded-xl border border-white/10 bg-black/40 p-1 shadow-inner"
          role="group"
          aria-label="Scope: single market or full region"
        >
          <button
            type="button"
            className={
              "rounded-lg px-4 py-2 font-tv text-sm font-bold transition-colors " +
              (p.isRegionScope ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-white")
            }
            onClick={p.onSelectRegion}
          >
            Region
          </button>
          <button
            type="button"
            className={
              "rounded-lg px-4 py-2 font-tv text-sm font-bold transition-colors " +
              (!p.isRegionScope ? "bg-white text-slate-900 shadow-md" : "text-slate-400 hover:text-white")
            }
            onClick={p.onSelectMarket}
          >
            Market
          </button>
        </div>
        <div className="text-right">
          <p className="font-tv text-[10px] font-bold uppercase tracking-widest text-slate-500">Now</p>
          <p className="font-display text-3xl leading-none tracking-wide text-white">{p.displayTime}</p>
          <p className="font-tv text-xs text-slate-500">{p.displayDate}</p>
        </div>
        <button
          type="button"
          onClick={p.onClose}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-tv text-sm font-bold text-white transition hover:bg-white/10"
        >
          Exit
        </button>
      </div>
    </header>
  );
}

function MVPBanner(p) {
  var m = p.mvp;
  var k = m && m.knocker;
  var c = m && m.closer;
  return (
    <div className="relative z-10 mx-5 mt-4 flex-shrink-0 motion-safe:animate-tv-float motion-reduce:animate-none" style={{ animationDelay: "0.1s" }}>
      <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-r from-amber-950/80 via-[#1a1408] to-amber-950/80 shadow-[0_0_60px_-12px_rgba(251,191,36,0.35)]">
        <div className="pointer-events-none absolute inset-0 motion-safe:animate-tv-shimmer motion-reduce:animate-none bg-[radial-gradient(ellipse_at_center_top,rgba(251,191,36,0.15),transparent_55%)]" />
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="relative grid grid-cols-1 gap-px bg-amber-500/20 md:grid-cols-2">
          <div className="bg-black/20 px-6 py-5 text-center md:text-left">
            <p className="font-tv text-[10px] font-bold uppercase tracking-[0.35em] text-amber-200/80">Weekly MVP · Knocker</p>
            {k && k.rid ? (
              <>
                <p className="mt-2 font-display text-5xl leading-none tracking-wide text-white md:text-6xl">{k.name}</p>
                <p className="mt-2 font-display text-4xl text-emerald-400">{k.sets}</p>
                <p className="font-tv text-sm font-semibold uppercase tracking-wide text-slate-500">sets this week</p>
                {k.market ? <p className="mt-1 font-tv text-sm text-slate-500">{k.market}</p> : null}
              </>
            ) : (
              <p className="mt-4 font-tv text-lg text-slate-500">No data</p>
            )}
          </div>
          <div className="bg-black/20 px-6 py-5 text-center md:border-l md:border-amber-500/20 md:text-left">
            <p className="font-tv text-[10px] font-bold uppercase tracking-[0.35em] text-amber-200/80">Weekly MVP · Closer</p>
            {c && c.rid ? (
              <>
                <p className="mt-2 font-display text-5xl leading-none tracking-wide text-white md:text-6xl">{c.name}</p>
                <p className="mt-2 font-display text-4xl text-emerald-400">{c.closes}</p>
                <p className="font-tv text-sm font-semibold uppercase tracking-wide text-slate-500">closed this week</p>
                {c.market ? <p className="mt-1 font-tv text-sm text-slate-500">{c.market}</p> : null}
              </>
            ) : (
              <p className="mt-4 font-tv text-lg text-slate-500">No data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TVMarketCard(p) {
  var card = p.card;
  if (!card || !card.st) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-4 font-tv text-slate-500 backdrop-blur-sm motion-safe:animate-tv-float motion-reduce:animate-none">
        No market summary.
      </div>
    );
  }
  var st = card.st;
  return (
    <div
      className="flex min-h-0 flex-shrink-0 flex-col rounded-2xl border border-emerald-500/25 bg-black/30 p-4 shadow-lg backdrop-blur-sm motion-safe:animate-tv-float motion-reduce:animate-none"
      style={{ animationDelay: "0.2s" }}
    >
      <p className="font-tv text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-300/80">This week · market</p>
      <p className="mt-1 font-display text-3xl tracking-wide text-white md:text-4xl">{card.title}</p>
      {card.region ? (
        <p className="font-tv text-sm text-slate-500">{card.marketCount + " offices · combined"}</p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-2 font-tv text-sm sm:grid-cols-3">
        <div>
          <p className="font-display text-2xl text-white">{st.closes}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Closes</p>
        </div>
        <div>
          <p className="font-display text-2xl text-white">{st.sets}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sets</p>
        </div>
        <div>
          <p className="font-display text-2xl text-white">{st.doors}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Doors</p>
        </div>
        <div>
          <p className="font-display text-2xl text-white">{st.convos}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Convos</p>
        </div>
        <div>
          <p className="font-display text-2xl text-emerald-300/90">{st.d2c != null ? st.d2c + "%" : "—"}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">D2C</p>
        </div>
        <div>
          <p className="font-display text-2xl text-emerald-300/90">{st.c2s != null ? st.c2s + "%" : "—"}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">C2S</p>
        </div>
      </div>
    </div>
  );
}

function rankStyle(i) {
  if (i === 0) return "bg-amber-400 text-black ring-2 ring-amber-300/80";
  if (i === 1) return "bg-slate-300 text-black ring-2 ring-slate-400/80";
  if (i === 2) return "bg-amber-800 text-amber-100 ring-2 ring-amber-700/80";
  return "bg-white/5 text-slate-400 ring-1 ring-white/10";
}

var LeaderboardRow = memo(function LeaderboardRow(p) {
  var i = p.index;
  var rank = i + 1;
  var top = i < 3;
  return (
    <div
      className={
        "flex items-stretch gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-300 " +
        (top ? "border-white/10 bg-white/[0.06]" : "border-transparent bg-white/[0.02] hover:bg-white/[0.04]")
      }
    >
      <div className={"flex w-12 shrink-0 items-center justify-center self-center rounded-lg font-display text-2xl " + rankStyle(i)}>
        {rank}
      </div>
      <div className="min-w-0 flex-1 self-center">
        <p className={"truncate font-display tracking-wide text-white " + (top ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl")}>{p.name}</p>
        <p className="font-tv text-xs text-slate-500 md:text-sm">
          {p.type === "knocker" ? (
            <>
              D2C {p.d2c}% · C2S {p.c2s}%
            </>
          ) : (
            <>Close {p.closeRate}%</>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center text-right">
        <span className={"font-display tabular-nums leading-none text-emerald-400 " + (top ? "text-4xl md:text-5xl" : "text-3xl md:text-4xl")}>
          {p.primary}
        </span>
        <span className="font-tv text-[10px] font-bold uppercase tracking-wider text-slate-500">{p.primaryLabel}</span>
        {p.streak > 0 ? <span className="mt-0.5 font-tv text-sm font-bold text-orange-400">🔥 {p.streak}d</span> : null}
      </div>
    </div>
  );
});

var Leaderboard = memo(function Leaderboard(p) {
  var title = p.type === "knocker" ? "Knockers" : "Closers";
  var sub = p.type === "knocker" ? "Sets · " + p.rangeLabel : "Closed · " + p.rangeLabel;
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-white/[0.07] bg-black/25 p-4 shadow-xl backdrop-blur-sm motion-safe:animate-tv-float motion-reduce:animate-none"
      style={p.motionStyle}
    >
      <div className="mb-3 flex-shrink-0 border-b border-white/10 pb-3">
        <h2 className="font-display text-4xl tracking-wide text-white md:text-5xl">{title}</h2>
        <p className="font-tv text-sm text-slate-500">{sub}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {p.rows.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-2 text-center font-tv text-base leading-snug text-slate-400">
            No activity for this week in the selected scope.
          </p>
        ) : (
          <TVAutoScroll
            resetKey={p.rows.length + "-" + p.type}
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1"
          >
            {p.rows.map(function (r, i) {
              return (
                <LeaderboardRow
                  key={r.rid}
                  index={i}
                  type={p.type}
                  name={r.name}
                  primary={r.primary}
                  primaryLabel={r.primaryLabel}
                  d2c={r.d2c}
                  c2s={r.c2s}
                  closeRate={r.closeRate}
                  streak={r.streak}
                />
              );
            })}
          </TVAutoScroll>
        )}
      </div>
    </section>
  );
});

function ChallengeMatchupCard(p) {
  var b = p.b;
  var market = p.variant === "market";
  if (b.bye) {
    return (
      <div
        className={
          "w-full shrink-0 rounded-2xl border border-white/15 bg-black/40 text-center backdrop-blur-sm " +
          (market
            ? "flex min-h-0 flex-1 flex-col justify-center px-10 py-14 md:py-20"
            : "px-8 py-10 md:py-12")
        }
      >
        <p className={"font-tv font-bold uppercase text-slate-500 " + (market ? "text-base" : "text-sm")}>Bye</p>
        <p
          className={
            "font-display tracking-wide text-white " + (market ? "text-5xl md:text-7xl" : "text-4xl md:text-5xl")
          }
        >
          {b.byeName}
        </p>
      </div>
    );
  }
  var gridGap = market ? "gap-8 md:gap-12" : "gap-5 md:gap-6";
  var nameSz = market ? "text-3xl md:text-5xl" : "text-2xl md:text-3xl";
  var closeSz = market ? "text-5xl md:text-8xl" : "text-4xl md:text-6xl";
  var pad = market ? "p-8 md:p-14" : "p-6 md:p-10";
  return (
    <div
      className={
        "w-full shrink-0 rounded-2xl border border-white/15 bg-gradient-to-b from-slate-900/90 to-black/80 shadow-xl backdrop-blur-sm " +
        pad +
        (market ? " flex min-h-0 flex-1 flex-col justify-center" : "")
      }
    >
      <p
        className={
          "mb-4 text-center font-tv font-bold uppercase tracking-wide text-amber-200/95 " +
          (market ? "text-xl md:text-2xl" : "text-base md:text-lg")
        }
      >
        {b.bannerText}
      </p>
      <div className={"grid grid-cols-2 " + gridGap}>
        {[b.left, b.right].map(function (col, idx) {
          if (!col) return null;
          return (
            <div
              key={idx}
              className={
                "rounded-2xl border px-4 py-4 md:px-8 md:py-6 " +
                (col.lead ? "border-emerald-400/50 bg-emerald-950/50" : "border-white/10 bg-white/[0.04]")
              }
            >
              <p className={"truncate font-display tracking-wide text-white " + nameSz}>{col.name}</p>
              <p className={"font-display leading-none text-emerald-400 " + closeSz}>{col.closes}</p>
              <p className={"font-tv font-bold uppercase text-slate-500 " + (market ? "text-sm md:text-base" : "text-xs md:text-sm")}>
                Closes
              </p>
              <p className={"font-tv text-slate-400 " + (market ? "text-base md:text-lg" : "text-sm md:text-base")}>
                {col.sets} sets · {col.doors} doors
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TVChallengeStrip(p) {
  if (!p.blocks || p.blocks.length === 0) {
    return (
      <div className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center font-tv text-sm text-slate-500 backdrop-blur-sm motion-safe:animate-tv-float motion-reduce:animate-none">
        Add two or more offices to run weekly matchups.
      </div>
    );
  }
  var region = p.isRegionScope === true;
  if (region) {
    return (
      <div
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col motion-safe:animate-tv-float motion-reduce:animate-none"
        style={{ animationDelay: "0.35s" }}
      >
        <p className="mb-3 font-tv text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">This week · challenge</p>
        <TVAutoScroll
          resetKey={"ch-" + p.blocks.length}
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto"
        >
          {p.blocks.map(function (b) {
            return <ChallengeMatchupCard key={b.key} b={b} variant="region" />;
          })}
        </TVAutoScroll>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col motion-safe:animate-tv-float motion-reduce:animate-none"
      style={{ animationDelay: "0.35s" }}
    >
      <p className="mb-3 shrink-0 font-tv text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">This week · challenge</p>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {p.blocks.map(function (b) {
          return <ChallengeMatchupCard key={b.key} b={b} variant="market" />;
        })}
      </div>
    </div>
  );
}

/**
 * Full-screen read-only scoreboard for office TVs.
 */
export default function TVView(p) {
  var _t = useState(function () {
    return new Date();
  }),
    tick = _t[0],
    setTick = _t[1];

  useEffect(
    function () {
      var id = window.setInterval(
        function () {
          setTick(new Date());
        },
        45000
      );
      return function () {
        window.clearInterval(id);
      };
    },
    [setTick]
  );

  var onKey = useCallback(
    function (e) {
      if (e.key === "Escape") p.onClose();
    },
    [p]
  );

  useEffect(
    function () {
      window.addEventListener("keydown", onKey);
      return function () {
        window.removeEventListener("keydown", onKey);
      };
    },
    [onKey]
  );

  var displayDate = tick.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  var displayTime = tick.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div
      className="fixed inset-0 z-[10050] overflow-hidden overscroll-none font-tv text-neutral-100 antialiased"
      role="dialog"
      aria-label="TV display mode"
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[#05080f]" />
      <div className="pointer-events-none absolute inset-0 z-0 motion-safe:animate-tv-breathe motion-reduce:animate-none bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(16,185,129,0.14),transparent_52%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 motion-safe:animate-tv-drift motion-reduce:animate-none bg-[radial-gradient(ellipse_80%_50%_at_80%_100%,rgba(59,130,246,0.08),transparent_45%)]" />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.32] motion-safe:animate-tv-grid motion-reduce:animate-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <TVYouTubeAmbient />
        <Header
          regionLabel={p.regionLabel}
          marketName={p.marketName}
          officeName={p.officeName}
          rangeLabel={p.rangeLabel}
          isRegionScope={p.isRegionScope}
          onSelectRegion={p.onSelectRegion}
          onSelectMarket={p.onSelectMarket}
          displayDate={displayDate}
          displayTime={displayTime}
          onClose={p.onClose}
        />
        <MVPBanner mvp={p.mvpWeek} />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 pb-5 pt-2 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <Leaderboard
              type="closer"
              rows={p.closerRows}
              rangeLabel={p.rangeLabel}
              motionStyle={{ animationDelay: "0.05s" }}
            />
            <Leaderboard
              type="knocker"
              rows={p.knockerRows}
              rangeLabel={p.rangeLabel}
              motionStyle={{ animationDelay: "0.12s" }}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <TVMarketCard card={p.marketCard} />
            <TVChallengeStrip blocks={p.challengeBlocks} isRegionScope={p.isRegionScope} />
          </div>
        </div>
      </div>
    </div>
  );
}
