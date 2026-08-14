import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { client } from "$lib/server/prisma";
import { getFormatter } from "$lib/server/i18n";
import { getShareTokenFromRequest, guestIdHeader, validateListShareToken } from "$lib/server/share-link";
import { getItemInclusions } from "$lib/server/items";
import { itemEmitter } from "$lib/server/events/emitters";
import { ItemEvent } from "$lib/events";

const guestItemSchema = (body: unknown) => {
    if (!body || typeof body !== "object") return null;
    const { name, url, note, guestName } = body as Record<string, unknown>;
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 500)) return null;
    if (typeof guestName !== "string" || !guestName.trim() || guestName.trim().length > 100) return null;
    if (url !== undefined && typeof url !== "string") return null;
    if (note !== undefined && typeof note !== "string") return null;
    return {
        name: typeof name === "string" ? name.trim() : undefined,
        guestName: guestName.trim(),
        url: typeof url === "string" ? url.trim() || null : null,
        note: typeof note === "string" ? note.trim() || null : null
    };
};

export const POST: RequestHandler = async ({ request, params, url }) => {
    const $t = await getFormatter();
    const list = await client.list.findUnique({
        where: { id: params.listId },
        select: { id: true, public: true, publicShareTokenHash: true, ownerId: true }
    });
    const validation = list && (await validateListShareToken(list, getShareTokenFromRequest(request, url)));
    if (!list || !validation?.valid || validation.access !== "edit" || !validation.shareLinkId) {
        error(401, $t("errors.not-authorized"));
    }
    const body = guestItemSchema(await request.json().catch(() => null));
    if (!body) error(422, $t("errors.item-not-found"));

    const requestedGuestId = request.headers.get(guestIdHeader);
    let guest = requestedGuestId
        ? await client.listGuest.findFirst({ where: { id: requestedGuestId, shareLinkId: validation.shareLinkId } })
        : null;
    if (guest && guest.name !== body.guestName) error(401, $t("errors.not-authorized"));
    if (!guest) {
        guest = await client.listGuest.create({ data: { shareLinkId: validation.shareLinkId, name: body.guestName } });
    }
    if (!body.name) {
        return new Response(JSON.stringify({ guest: { id: guest.id, name: guest.name } }), { status: 200 });
    }

    const item = await client.item.create({
        data: {
            userId: list.ownerId,
            createdById: list.ownerId,
            name: body.name,
            url: body.url,
            note: body.note,
            lists: { create: { listId: list.id, addedById: list.ownerId, guestId: guest.id } }
        },
        include: getItemInclusions(list.id)
    });
    itemEmitter.emit(ItemEvent.ITEM_CREATE, item);
    return new Response(JSON.stringify({ guest: { id: guest.id, name: guest.name } }), { status: 201 });
};
