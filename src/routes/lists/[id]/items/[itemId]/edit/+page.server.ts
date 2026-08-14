import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { client } from "$lib/server/prisma";
import { getByIdForAccess } from "$lib/server/list";
import { getShareTokenFromUrl, validateListShareToken } from "$lib/server/share-link";
import { extractFormData, getItemUpdateSchema } from "$lib/server/validations";
import { createImage, isValidImage, tryDeleteImage } from "$lib/server/image-util";
import { getMinorUnits } from "$lib/price-formatter";
import { getLocale } from "$lib/server/i18n";
import { getFormatter } from "$lib/server/i18n";
import { itemEmitter } from "$lib/server/events/emitters";
import { ItemEvent } from "$lib/events";
import { getItemInclusions } from "$lib/server/items";
import z from "zod";

const access = async (listId: string, itemId: string, token: string | null, guestId: string | null) => {
    const list = await getByIdForAccess(listId);
    const share = list && (await validateListShareToken(list, token));
    const listItem = await client.listItem.findUnique({
        where: { listId_itemId: { listId, itemId: Number(itemId) } },
        select: { guestId: true }
    });
    const guest =
        guestId && share?.shareLinkId
            ? await client.listGuest.findFirst({ where: { id: guestId, shareLinkId: share.shareLinkId } })
            : null;
    const allowed =
        !!list &&
        !!listItem &&
        !!guest &&
        share?.valid &&
        share.access === "edit" &&
        (list.anonymousEditPolicy === "all" ||
            (list.anonymousEditPolicy === "guest" && !!listItem.guestId) ||
            (list.anonymousEditPolicy === "own" && listItem.guestId === guest.id));
    return { list, allowed };
};

export const load: PageServerLoad = async ({ params, url }) => {
    const $t = await getFormatter();
    const list = await getByIdForAccess(params.id);
    const share = list && (await validateListShareToken(list, getShareTokenFromUrl(url)));
    if (!list || !share?.valid || share.access !== "edit") error(404, $t("errors.list-not-found"));
    const item = await client.item.findFirst({
        where: { id: Number(params.itemId), lists: { some: { listId: params.id } } },
        include: { itemPrice: true }
    });
    if (!item) error(404, $t("errors.item-not-found"));
    return { item, listId: params.id, shareToken: getShareTokenFromUrl(url) };
};

export const actions: Actions = {
    default: async ({ request, params, url }) => {
        const $t = await getFormatter();
        const formData = await request.formData();
        const { list, allowed } = await access(
            params.id,
            params.itemId,
            getShareTokenFromUrl(url),
            String(formData.get("guestId") || "") || null
        );
        if (!list || !allowed) return fail(401, { message: $t("errors.not-authorized") });
        const parsed = (await getItemUpdateSchema()).safeParse(extractFormData(formData));
        if (!parsed.success) return fail(422, { errors: z.flattenError(parsed.error).fieldErrors });
        const data = parsed.data;
        let imageUrl: string | null | undefined;
        if (data.image && isValidImage(data.image)) imageUrl = await createImage(data.name, data.image);
        else if (data.imageUrl) imageUrl = await createImage(data.name, data.imageUrl);
        const current = await client.item.findUniqueOrThrow({
            where: { id: Number(params.itemId) },
            select: { imageUrl: true, itemPriceId: true }
        });
        let itemPriceId: string | null = null;
        if (data.price && data.currency) {
            const price = await client.itemPrice.create({
                data: {
                    value: getMinorUnits(parseFloat(data.price), data.currency, getLocale()),
                    currency: data.currency
                }
            });
            itemPriceId = price.id;
        }
        const updated = await client.item.update({
            where: { id: Number(params.itemId) },
            data: {
                name: data.name,
                url: data.url,
                note: data.note,
                quantity: data.quantity,
                optional: data.optional,
                mostWanted: data.mostWanted,
                imageUrl,
                itemPriceId
            },
            include: getItemInclusions(params.id)
        });
        if (current.itemPriceId && current.itemPriceId !== itemPriceId)
            await client.itemPrice.delete({ where: { id: current.itemPriceId } });
        if (imageUrl !== undefined && current.imageUrl) await tryDeleteImage(current.imageUrl);
        itemEmitter.emit(ItemEvent.ITEM_UPDATE, updated);
        redirect(303, `/lists/${params.id}?share=${encodeURIComponent(getShareTokenFromUrl(url) || "")}`);
    }
};
