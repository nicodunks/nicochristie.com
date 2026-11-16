-- The homepage is now the drawing agent's page (draw/), which talks to the model through /api/draw. The sheets of the
-- page before it, one Managed Agent session each, are gone.
DROP TABLE sheets;
-- One row per drawing whose first request passed the bot check. The guard caps how many drawings one internet
-- connection and all visitors together may start in a rolling day.
CREATE TABLE draw_pages (page TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX draw_pages_age ON draw_pages(created_at);
CREATE INDEX draw_pages_ip ON draw_pages(ip_hash,created_at);
CREATE TRIGGER draw_guard BEFORE INSERT ON draw_pages WHEN NOT EXISTS(SELECT 1 FROM draw_pages WHERE page=NEW.page) BEGIN
 SELECT (CASE WHEN (SELECT COUNT(*) FROM draw_pages WHERE ip_hash=NEW.ip_hash AND created_at>NEW.created_at-86400)>=30 THEN RAISE(ABORT,'draw_limit') END);
 SELECT (CASE WHEN (SELECT COUNT(*) FROM draw_pages WHERE created_at>NEW.created_at-86400)>=200 THEN RAISE(ABORT,'draw_busy') END);
END;
-- One row per call to the model: what it cost at list prices, in micros, millionths of a US dollar. While the call
-- runs the row holds an estimate, so the caps on a drawing, a connection and a day count calls still running.
CREATE TABLE draw_calls (id TEXT PRIMARY KEY, page TEXT NOT NULL, ip_hash TEXT NOT NULL, micros INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX draw_calls_page ON draw_calls(page);
CREATE INDEX draw_calls_ip ON draw_calls(ip_hash,created_at);
CREATE INDEX draw_calls_age ON draw_calls(created_at);
