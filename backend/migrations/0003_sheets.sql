-- One row per sheet: a visitor's session of the drawing agent. The guard caps how many sheets one internet
-- connection and all visitors together may start in a rolling day, which bounds what the agent can cost.
CREATE TABLE sheets (id TEXT PRIMARY KEY, session TEXT, ip_hash TEXT NOT NULL, turns INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX sheets_age ON sheets(created_at);
CREATE INDEX sheets_ip ON sheets(ip_hash,created_at);
CREATE UNIQUE INDEX sheets_session ON sheets(session);
CREATE TRIGGER sheet_guard BEFORE INSERT ON sheets BEGIN
 SELECT (CASE WHEN (SELECT COUNT(*) FROM sheets WHERE ip_hash=NEW.ip_hash AND created_at>NEW.created_at-86400)>=8 THEN RAISE(ABORT,'sheet_limit') END);
 SELECT (CASE WHEN (SELECT COUNT(*) FROM sheets WHERE created_at>NEW.created_at-86400)>=200 THEN RAISE(ABORT,'sheet_busy') END);
END;
