ALTER TABLE "list" ADD COLUMN "pricePollIntervalMinutes" INTEGER NOT NULL DEFAULT 720;

ALTER TABLE "items" ADD COLUMN "pricePollingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN "nextPricePollAt" DATETIME;
ALTER TABLE "items" ADD COLUMN "lastPricePolledAt" DATETIME;

CREATE TABLE "item_price_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "polledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_price_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "items_pricePollingEnabled_nextPricePollAt_idx" ON "items"("pricePollingEnabled", "nextPricePollAt");
CREATE INDEX "item_price_history_itemId_polledAt_idx" ON "item_price_history"("itemId", "polledAt");
