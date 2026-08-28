// Read API the app calls. GET /signals -> latest signal per market.
// GET /trades -> open positions + recent closed trades + a summary (win rate, PF).
const { queryPk } = require('./db');

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

function summarize(closed) {
  const wins = closed.filter((c) => c.pnl > 0), losses = closed.filter((c) => c.pnl < 0);
  const gw = wins.reduce((s, c) => s + c.pnl, 0), gl = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
  const decisive = wins.length + losses.length;
  return {
    trades: closed.length,
    winRate: decisive ? Math.round((wins.length / decisive) * 100) : 0,
    profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0),
    totalPnl: closed.reduce((s, c) => s + (c.pnl || 0), 0),
  };
}

exports.handler = async (event) => {
  const path = event?.requestContext?.http?.path || event?.rawPath || '';
  try {
    if (path.endsWith('/signals')) {
      const items = await queryPk('SIGNAL');
      return json({ updatedAt: Date.now(), signals: items });
    }
    if (path.endsWith('/trades')) {
      const [open, closed] = await Promise.all([
        queryPk('POS#OPEN'),
        queryPk('TRADE', { limit: 200, scanForward: false }), // newest first (sk is zero-padded closedAt)
      ]);
      return json({ open, closed, summary: summarize(closed) });
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
