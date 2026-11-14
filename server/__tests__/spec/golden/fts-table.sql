CREATE VIRTUAL TABLE "fts:tickets" USING fts5("subject", "or", content='tickets', content_rowid='rowid', tokenize='trigram case_sensitive 0');
CREATE TRIGGER "fts:tickets:ai" AFTER INSERT ON "tickets" BEGIN
  INSERT INTO "fts:tickets"(rowid, "subject", "or") VALUES (new.rowid, new."subject", new."or");
END;
CREATE TRIGGER "fts:tickets:ad" AFTER DELETE ON "tickets" BEGIN
  INSERT INTO "fts:tickets"("fts:tickets", rowid, "subject", "or") VALUES ('delete', old.rowid, old."subject", old."or");
END;
CREATE TRIGGER "fts:tickets:au" AFTER UPDATE OF "subject", "or" ON "tickets" BEGIN
  INSERT INTO "fts:tickets"("fts:tickets", rowid, "subject", "or") VALUES ('delete', old.rowid, old."subject", old."or");
  INSERT INTO "fts:tickets"(rowid, "subject", "or") VALUES (new.rowid, new."subject", new."or");
END;
