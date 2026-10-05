const {Pool} = require('pg'), cfg = require('./config');
module.exports = new Pool({connectionString: cfg.databaseUrl, ssl: cfg.isProd && process.env.PGSSL !== 'off' ? {rejectUnauthorized: false} : false, max: 10});
