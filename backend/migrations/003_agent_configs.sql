CREATE TABLE IF NOT EXISTS agent_configs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    slider1 INT NOT NULL DEFAULT 50,
    slider2 INT NOT NULL DEFAULT 50,
    custom_directives TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_name)
);
