CREATE TABLE "item_dependency" (
    "itemId" INTEGER NOT NULL,
    "dependsOnId" INTEGER NOT NULL,
    CONSTRAINT "item_dependency_itemId_dependsOnId_pkey" PRIMARY KEY ("itemId", "dependsOnId"),
    CONSTRAINT "item_dependency_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_dependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_dependency_itemId_dependsOnId_check" CHECK ("itemId" <> "dependsOnId")
);

CREATE INDEX "item_dependency_dependsOnId_idx" ON "item_dependency"("dependsOnId");
