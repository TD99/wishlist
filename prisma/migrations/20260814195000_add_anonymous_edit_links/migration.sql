ALTER TABLE "list" ADD COLUMN "anonymousEditPolicy" TEXT NOT NULL DEFAULT 'guest';
ALTER TABLE "list_share_link" ADD COLUMN "access" TEXT NOT NULL DEFAULT 'view';
ALTER TABLE "list_item" ADD COLUMN "guestId" TEXT;

CREATE TABLE "list_guest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareLinkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "list_guest_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "list_share_link" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "list_guest_shareLinkId_idx" ON "list_guest"("shareLinkId");
CREATE INDEX "list_item_guestId_idx" ON "list_item"("guestId");
