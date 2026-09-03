// Asset-class registry — the multi-asset foundation (Phase 0, 2026-09-03).
// See docs/phase-0-multi-asset.md.
//
// Each asset class groups a universe of markets and declares, per trading style, a
// CELL — the (class × style) unit that has its own validation status and (later) its
// own signals + paper record. This module is DESCRIPTIVE scaffolding: it mirrors what
// the schedulers already trade today, so importing/reading it changes no behaviour.
// Later phases route signals, records, and screens through it; nothing does yet.
import { MARKETS } from './markets.js';

// Cell status vocabulary (drives honest UI later):
//   'live'       — proven & running; shows real signals, in the tracked record.
//   'experiment' — shipped but UNPROVEN; ungated, clearly-labelled, own record.
//   'planned'    — designed, not built; a "coming" state, no signals.
//   'blocked'    — infeasible now (e.g. scalping needs sub-minute tick data we lack).
export const CELL_STATUS = ['live', 'experiment', 'planned', 'blocked'];

export const ASSET_CLASSES = {
  index: {
    key: 'index',
    name: 'Equity indices',            // US index futures + global cash indices — the proven domain
    model: 'tracked',                  // 'tracked' (curated set) | 'screener' (scan+rank) — Phase 2
    // The full class universe (what the markets screen groups). A style may validate
    // on FEWER names than the universe — that subset lives in styles[].markets.
    universe: ['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX'],
    styles: {
      // Swing = the proven Ajent Pulse ensemble. XJO shows a signal but isn't opened
      // (noTrade), so it's absent from the traded subset — matches markets.js today.
      swing: { status: 'live', markets: ['ES', 'NQ', 'YM', 'RTY', 'SX5E', 'N225', 'TSX'] },
      // Day = the shipped intraday EXPERIMENT (daytrade.js). RTY excluded — net loser
      // intraday (PF 0.69). Its own isolated record (RECORD_DAY / SIGNALS_DAY).
      day: { status: 'experiment', markets: ['ES', 'NQ', 'YM'] },
    },
  },
  crypto: {
    key: 'crypto',
    name: 'Crypto',
    model: 'tracked',
    universe: ['BTC', 'ETH'],
    styles: {
      // Swing runs on crypto today, but the RSI-2 edge is NOT validated there —
      // honest status is 'experiment' (tracked, unproven), never 'live'.
      swing: { status: 'experiment', markets: ['BTC', 'ETH'] },
    },
  },

  // ── Phase 1 / 2 stubs — DECLARED, not wired (no live cell, no universe traded).
  // Uncomment + validate per cell before flipping any status to 'live'. Kept here so
  // the registry documents the roadmap without implying these markets exist yet.
  // forex:  { key: 'forex',  name: 'Forex',  model: 'tracked',  universe: [], styles: { swing: { status: 'planned' }, day: { status: 'planned' } } },
  // etf:    { key: 'etf',    name: 'ETFs',   model: 'tracked',  universe: [], styles: { swing: { status: 'planned' } } },
  // stocks: { key: 'stocks', name: 'Stocks', model: 'screener', scan: {},     styles: { swing: { status: 'planned' } } },
};

// The trading styles that can appear across classes (a style is a column; a class is
// a row; a cell is their intersection). Order = display order.
export const STYLES = ['swing', 'day'];

export function classFor(classKey) { return ASSET_CLASSES[classKey] || null; }

export function assetClassOf(symbol) {
  const m = MARKETS[symbol];
  return (m && m.assetClass) || null;
}

// Status of one (class × style) cell, or null if the cell isn't declared.
export function cellStatus(classKey, styleKey) {
  const c = ASSET_CLASSES[classKey];
  const s = c && c.styles && c.styles[styleKey];
  return s ? s.status : null;
}

// The markets a given cell trades — its validated subset, falling back to the whole
// class universe when a cell doesn't narrow it.
export function cellMarkets(classKey, styleKey) {
  const c = ASSET_CLASSES[classKey];
  const s = c && c.styles && c.styles[styleKey];
  return (s && s.markets) || (c && c.universe) || [];
}

// Every declared cell, flattened — handy for iterating (schedulers, later phases).
export function allCells() {
  const out = [];
  for (const c of Object.values(ASSET_CLASSES)) {
    for (const styleKey of Object.keys(c.styles || {})) {
      out.push({ classKey: c.key, styleKey, status: c.styles[styleKey].status });
    }
  }
  return out;
}
