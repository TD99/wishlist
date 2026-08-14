import { getFormatter } from "$lib/server/i18n";
import { itemEmitter } from "$lib/server/events/emitters";
import { client } from "$lib/server/prisma";
import type { RequestHandler } from "./$types";
import { error } from "@sveltejs/kit";
import { listItemUpdateSchema } from "$lib/server/validations";
import { getItemInclusions } from "$lib/server/items";
import { ItemEvent } from "$lib/events";
import { tryDeleteImage } from "$lib/server/image-util";
import { requireLoginOrError } from "$lib/server/auth";
import { logger } from "$lib/server/logger";
import z from "zod";
import { getShareTokenFromRequest, guestIdHeader, validateListShareToken } from "$lib/server/share-link";

// Approve an item on a list
export const PATCH: RequestHandler = async ({ request, params, url, locals }) => {
    if (!locals.user) {
        const $t = await getFormatter();
        const body = (await request.json().catch(() => null)) as {
            name?: unknown;
            url?: unknown;
            note?: unknown;
        } | null;
        if (!body || typeof body.name !== "string" || !body.name.trim()) error(422, $t("errors.item-not-found"));
        const [list, listItem] = await Promise.all([
            client.list.findUnique({
                where: { id: params.listId },
                select: { id: true, public: true, publicShareTokenHash: true, anonymousEditPolicy: true }
            }),
            client.listItem.findUnique({
                where: { listId_itemId: { listId: params.listId, itemId: parseInt(params.itemId) } },
                select: { guestId: true }
            })
        ]);
        const share = list && (await validateListShareToken(list, getShareTokenFromRequest(request, url)));
        const guestId = request.headers.get(guestIdHeader);
        const guest =
            guestId && share?.shareLinkId
                ? await client.listGuest.findFirst({ where: { id: guestId, shareLinkId: share.shareLinkId } })
                : null;
        const allowed =
            !!guest &&
            !!listItem &&
            share?.valid &&
            share.access === "edit" &&
            (list!.anonymousEditPolicy === "all" ||
                (list!.anonymousEditPolicy === "guest" && !!listItem.guestId) ||
                (list!.anonymousEditPolicy === "own" && listItem.guestId === guest.id));
        if (!allowed) error(401, $t("errors.not-authorized"));
        await client.item.update({
            where: { id: parseInt(params.itemId) },
            data: {
                name: body.name.trim(),
                url: typeof body.url === "string" ? body.url.trim() || null : null,
                note: typeof body.note === "string" ? body.note.trim() || null : null
            }
        });
        return new Response(null, { status: 200 });
    }
    const user = await requireLoginOrError();
    const $t = await getFormatter();

    const list = await client.list.findUnique({
        select: {
            ownerId: true,
            managers: {
                select: {
                    userId: true
                }
            }
        },
        where: {
            id: params.listId
        }
    });
    if (!list) {
        error(404, $t("errors.list-not-found"));
    } else if (list.ownerId !== user.id && !list.managers.find(({ userId }) => userId === user.id)) {
        error(401, $t("errors.not-authorized"));
    }
    if (isNaN(parseInt(params.itemId))) {
        error(400, $t("errors.item-id-must-be-a-number"));
    }

    const body = (await request.json()) as Record<string, unknown>[];
    const updateData = listItemUpdateSchema.safeParse(body);

    if (updateData.error) {
        error(422, JSON.stringify(z.flattenError(updateData.error).fieldErrors));
    }

    try {
        if (updateData.data.approved !== null && updateData.data.approved !== undefined) {
            await client.listItem.update({
                where: {
                    listId_itemId: {
                        listId: params.listId,
                        itemId: parseInt(params.itemId)
                    }
                },
                data: {
                    approved: updateData.data.approved
                }
            });

            const item = await client.item.findUnique({
                where: {
                    id: parseInt(params.itemId)
                },
                include: getItemInclusions(params.listId)
            });
            if (item) itemEmitter.emit(ItemEvent.ITEM_UPDATE, item);
        }

        return new Response(null, { status: 200 });
    } catch (err) {
        logger.error({ err }, "Error patching list item");
        error(404, $t("errors.item-not-found"));
    }
};

// Delete an item on a list
export const DELETE: RequestHandler = async ({ request, params, url, locals }) => {
    const user = locals.user;
    const $t = await getFormatter();

    if (isNaN(parseInt(params.itemId))) {
        error(400, $t("errors.item-id-must-be-a-number"));
    }

    const [list, item, listItem, claims] = await Promise.all([
        client.list.findUnique({
            select: {
                id: true,
                ownerId: true,
                public: true,
                publicShareTokenHash: true,
                anonymousEditPolicy: true,
                managers: {
                    select: {
                        userId: true
                    }
                }
            },
            where: {
                id: params.listId
            }
        }),
        client.item.findUnique({
            select: {
                id: true,
                userId: true,
                createdById: true,
                imageUrl: true,
                lists: {
                    select: {
                        id: true
                    }
                }
            },
            where: {
                id: parseInt(params.itemId)
            }
        }),
        client.listItem.findUnique({
            select: {
                id: true,
                addedById: true,
                guestId: true
            },
            where: {
                listId_itemId: {
                    listId: params.listId,
                    itemId: parseInt(params.itemId)
                }
            }
        }),
        client.itemClaim.findMany({
            select: {
                id: true
            },
            where: {
                listId: params.listId,
                itemId: parseInt(params.itemId)
            }
        })
    ]);

    if (!listItem) {
        error(404, $t("errors.item-not-found-on-list"));
    }
    if (!list) {
        error(404, $t("errors.list-not-found"));
    }
    if (!item) {
        error(404, $t("errors.item-not-found"));
    }

    const isAuthenticatedManager =
        !!user && (list.ownerId === user.id || list.managers.some(({ userId }) => userId === user.id));
    const isAuthenticatedAdder = !!user && listItem.addedById === user.id;
    let isGuestAllowed = false;
    if (!user) {
        const share = await validateListShareToken(list, getShareTokenFromRequest(request, url));
        const guestId = request.headers.get(guestIdHeader);
        if (share.valid && share.access === "edit" && guestId) {
            const guest = await client.listGuest.findFirst({ where: { id: guestId, shareLinkId: share.shareLinkId } });
            if (guest) {
                isGuestAllowed =
                    list.anonymousEditPolicy === "all" ||
                    (list.anonymousEditPolicy === "guest" && !!listItem.guestId) ||
                    (list.anonymousEditPolicy === "own" && listItem.guestId === guest.id);
            }
        }
    }
    if (!isAuthenticatedAdder && !isAuthenticatedManager && !isGuestAllowed) error(401, $t("errors.not-authorized"));

    try {
        await client.$transaction(async (tx) => {
            await tx.listItem.delete({
                where: {
                    id: listItem.id
                }
            });

            if (claims.length > 0) {
                await tx.itemClaim.deleteMany({
                    where: {
                        id: {
                            in: claims.map(({ id }) => id)
                        }
                    }
                });
            }

            // Item was only on this list, we should delete it
            if (
                item.lists.length === 1 &&
                (isGuestAllowed || (!!user && (item.createdById === user.id || item.userId === user.id)))
            ) {
                await tx.item.delete({
                    where: {
                        id: item.id
                    }
                });
                if (item.imageUrl) tryDeleteImage(item.imageUrl);
            }
        });

        itemEmitter.emit(ItemEvent.ITEM_DELETE, { id: parseInt(params.itemId), lists: [{ id: params.listId }] });

        return new Response(null, { status: 200 });
    } catch (err) {
        logger.error({ err }, "Error deleting list item");
        error(404, $t("errors.item-not-found"));
    }
};
