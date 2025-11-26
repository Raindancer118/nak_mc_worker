DROP TABLE IF EXISTS cheat_logs;
DROP TABLE IF EXISTS time_logs;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS solved_seeds;

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'SOLO' or 'TEAM'
    seed TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED', -- 'CREATED', 'RUNNING', 'PAUSED', 'FINISHED', 'ABORTED'
    created_at INTEGER NOT NULL,
    ended_at INTEGER
);

CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    minecraft_name TEXT NOT NULL,
    role TEXT NOT NULL, -- 'RUNNER' or 'SPECTATOR' (though spectators might not be strictly needed here if handled by plugin, good to track)
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'START', 'PAUSE', 'RESUME', 'END'
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE cheat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    details TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE solved_seeds (
    seed TEXT PRIMARY KEY,
    solved_at INTEGER NOT NULL
);
