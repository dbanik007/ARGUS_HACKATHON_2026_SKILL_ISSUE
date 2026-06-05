'use strict';

const DEFAULT_CONFIGS = {
  'Account Executive':   { slider1: 65, slider2: 40, customDirectives: '' },
  'Legal':               { slider1: 15, slider2: 5,  customDirectives: '' },
  'Resource':            { slider1: 50, slider2: 75, customDirectives: '' },
  'Financial':           { slider1: 30, slider2: 60, customDirectives: '' },
  'Technical Architect': { slider1: 40, slider2: 70, customDirectives: '' },
  'Risk Analyst':        { slider1: 30, slider2: 40, customDirectives: '' },
  'Operations Manager':  { slider1: 60, slider2: 65, customDirectives: '' },
  'Board of Directors':  { slider1: 85, slider2: 90, customDirectives: '' }
};

const getConfigsForUser = async (pool, userId) => {
  const configs = {};
  for (const [name, defaults] of Object.entries(DEFAULT_CONFIGS)) {
    configs[name] = { ...defaults };
  }

  if (!pool || !userId) return configs;

  try {
    const result = await pool.query(
      'SELECT agent_name, slider1, slider2, custom_directives FROM agent_configs WHERE user_id = $1',
      [userId]
    );
    for (const row of result.rows) {
      if (configs[row.agent_name]) {
        configs[row.agent_name] = {
          slider1: row.slider1,
          slider2: row.slider2,
          customDirectives: row.custom_directives
        };
      }
    }
  } catch (err) {
    console.error('[agentConfigs] DB read failed, using defaults:', err.message);
  }

  return configs;
};

const updateConfigsForUser = async (pool, userId, newConfigs) => {
  if (!pool || !userId) throw new Error('DB pool and userId are required');

  for (const [agentName, cfg] of Object.entries(newConfigs)) {
    if (!DEFAULT_CONFIGS[agentName]) continue;
    const directives = (cfg.customDirectives ?? '').slice(0, 500);
    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_name, slider1, slider2, custom_directives, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, agent_name) DO UPDATE
         SET slider1 = EXCLUDED.slider1,
             slider2 = EXCLUDED.slider2,
             custom_directives = EXCLUDED.custom_directives,
             updated_at = NOW()`,
      [userId, agentName, cfg.slider1 ?? 50, cfg.slider2 ?? 50, directives]
    );
  }

  return getConfigsForUser(pool, userId);
};

module.exports = { getConfigsForUser, updateConfigsForUser, DEFAULT_CONFIGS };
