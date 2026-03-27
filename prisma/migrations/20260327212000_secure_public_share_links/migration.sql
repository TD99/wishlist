ALTER TABLE "list" ADD COLUMN "publicShareTokenHash" TEXT;
ALTER TABLE "list" ADD COLUMN "publicShareTokenCreatedAt" DATETIME;

CREATE UNIQUE INDEX "list_publicShareTokenHash_key" ON "list"("publicShareTokenHash");
