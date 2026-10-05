const express = require('express'), {ok, h, bad, str, id, page, ApiError} = require('../http'), {requireAuth} = require('../middleware'), {notify} = require('../services/notify');
const threadKey = (a, b) => [String(a), String(b)].sort((x, y) => Number(x) - Number(y)).join('_');
module.exports = (db) => {
  const r = express.Router(); r.use(requireAuth);
  // Thread keys are derived on the server from (me, other): a user can only ever reach threads they are part of.
  r.get('/', h(async (q, s) => { const me = q.user.id;
    const rows = (await db.query(`SELECT DISTINCT ON (t.other) t.other, t.body AS last, t.created_at AS at, u.name,
      (SELECT count(*)::int FROM messages z WHERE z.to_id=$1 AND z.from_id=t.other AND z.read_at IS NULL) AS unread
      FROM (SELECT CASE WHEN m.from_id=$1 THEN m.to_id ELSE m.from_id END AS other, m.body, m.created_at, m.id FROM messages m WHERE m.from_id=$1 OR m.to_id=$1) t
      JOIN users u ON u.id=t.other ORDER BY t.other, t.id DESC`, [me])).rows;
    rows.sort((a, b) => new Date(b.at) - new Date(a.at)); ok(s, {data: rows.map(x => ({with: String(x.other), name: x.name, last: x.last, at: x.at, unread: x.unread})), unread: rows.reduce((n, x) => n + x.unread, 0)}); }));
  r.get('/:withId', h(async (q, s) => { const o = id(q.params.withId, 'user'), p = (await db.query('SELECT id,name FROM users WHERE id=$1', [o])).rows[0]; if (!p) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
    const pg = page(q.query), t = threadKey(q.user.id, o), ms = (await db.query('SELECT * FROM (SELECT * FROM messages WHERE thread=$1 ORDER BY id DESC LIMIT $2 OFFSET $3) x ORDER BY id', [t, pg.limit, pg.offset])).rows;
    await db.query('UPDATE messages SET read_at=now() WHERE thread=$1 AND to_id=$2 AND read_at IS NULL', [t, q.user.id]);
    ok(s, {with: {id: String(p.id), name: p.name}, data: ms.map(m => ({id: String(m.id), mine: String(m.from_id) === String(q.user.id), body: m.body, at: m.created_at}))}); }));
  r.post('/', h(async (q, s) => { const to = id(q.body.to_id, 'to_id'), body = str(q.body.body, 'body', {min: 1, max: 4000, required: true}); if (String(to) === String(q.user.id)) throw bad('You cannot message yourself');
    const p = (await db.query("SELECT id FROM users WHERE id=$1 AND status='active'", [to])).rows[0]; if (!p) throw new ApiError(404, 'NOT_FOUND', 'Recipient not found.');
    const m = (await db.query('INSERT INTO messages(thread,from_id,to_id,body) VALUES($1,$2,$3,$4) RETURNING id', [threadKey(q.user.id, to), q.user.id, to, body])).rows[0]; await notify(db, to, 'New message from ' + q.user.name, 'message', '#/chat/' + q.user.id); ok(s, {id: String(m.id)}, 201); }));
  return r;
};
