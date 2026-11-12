-- A reload now starts a new sheet, so one connection may start 30 sheets in a rolling day, up from 8. All visitors
-- together may still start 200.
DROP TRIGGER sheet_guard;
CREATE TRIGGER sheet_guard BEFORE INSERT ON sheets BEGIN
 SELECT (CASE WHEN (SELECT COUNT(*) FROM sheets WHERE ip_hash=NEW.ip_hash AND created_at>NEW.created_at-86400)>=30 THEN RAISE(ABORT,'sheet_limit') END);
 SELECT (CASE WHEN (SELECT COUNT(*) FROM sheets WHERE created_at>NEW.created_at-86400)>=200 THEN RAISE(ABORT,'sheet_busy') END);
END;
