CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    picture VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evaluation_sessions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    tender_name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    budget NUMERIC(12, 2) NOT NULL,
    timeline_months INT NOT NULL,
    industry VARCHAR(100) NOT NULL,
    roster VARCHAR(255)[] NOT NULL,
    final_verdict VARCHAR(50),
    final_budget NUMERIC(12, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS debate_messages (
    id SERIAL PRIMARY KEY,
    session_id INT REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
    sender VARCHAR(100) NOT NULL,
    message_text TEXT NOT NULL,
    negotiation_round INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
