CREATE TABLE "list_share_link" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "list_share_link_listId_fkey" FOREIGN KEY ("listId") REFERENCES "list" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "list_share_link_accessor" (
    "shareLinkId" TEXT NOT NULL,
    "accessorId" TEXT NOT NULL,
    "firstAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("shareLinkId", "accessorId"),
    CONSTRAINT "list_share_link_accessor_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "list_share_link" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "list_share_link_tokenHash_key" ON "list_share_link"("tokenHash");
CREATE INDEX "list_share_link_listId_idx" ON "list_share_link"("listId");
CREATE INDEX "list_share_link_accessor_accessorId_idx" ON "list_share_link_accessor"("accessorId");
