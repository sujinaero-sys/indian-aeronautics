module.exports = {
  notify: (db, userId, text, kind = 'system', link = null) => userId ? db.query('INSERT INTO notifications(user_id,kind,text,link) VALUES($1,$2,$3,$4)', [userId, kind, text, link]) : null,
};
