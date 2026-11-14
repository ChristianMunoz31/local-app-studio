CREATE VIRTUAL TABLE IF NOT EXISTS "fts:people" USING fts5("name", content='people', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER IF NOT EXISTS "fts:people:ai" AFTER INSERT ON "people" BEGIN
  INSERT INTO "fts:people"(rowid, "name") VALUES (new.rowid, new."name");
END;
CREATE TRIGGER IF NOT EXISTS "fts:people:ad" AFTER DELETE ON "people" BEGIN
  INSERT INTO "fts:people"("fts:people", rowid, "name") VALUES ('delete', old.rowid, old."name");
END;
CREATE TRIGGER IF NOT EXISTS "fts:people:au" AFTER UPDATE OF "name" ON "people" BEGIN
  INSERT INTO "fts:people"("fts:people", rowid, "name") VALUES ('delete', old.rowid, old."name");
  INSERT INTO "fts:people"(rowid, "name") VALUES (new.rowid, new."name");
END;
CREATE VIRTUAL TABLE IF NOT EXISTS "fts:crews" USING fts5("name", content='crews', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER IF NOT EXISTS "fts:crews:ai" AFTER INSERT ON "crews" BEGIN
  INSERT INTO "fts:crews"(rowid, "name") VALUES (new.rowid, new."name");
END;
CREATE TRIGGER IF NOT EXISTS "fts:crews:ad" AFTER DELETE ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name") VALUES ('delete', old.rowid, old."name");
END;
CREATE TRIGGER IF NOT EXISTS "fts:crews:au" AFTER UPDATE OF "name" ON "crews" BEGIN
  INSERT INTO "fts:crews"("fts:crews", rowid, "name") VALUES ('delete', old.rowid, old."name");
  INSERT INTO "fts:crews"(rowid, "name") VALUES (new.rowid, new."name");
END;
