import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { client } from "$lib/server/prisma";
import { getByIdForAccess, getNextDisplayOrderForLists } from "$lib/server/list";
import { getShareTokenFromUrl, validateListShareToken } from "$lib/server/share-link";
import { extractFormData, getItemCreateSchema } from "$lib/server/validations";
import { createImage, isValidImage } from "$lib/server/image-util";
import { getMinorUnits } from "$lib/price-formatter";
import { getFormatter, getLocale } from "$lib/server/i18n";
import { itemEmitter } from "$lib/server/events/emitters";
import { ItemEvent } from "$lib/events";
import { getItemInclusions } from "$lib/server/items";
import z from "zod";

const getAccess = async (listId: string, token: string | null, guestId: string | null) => {
    const list = await getByIdForAccess(listId);
    const share = list && (await validateListShareToken(list, token));
    const guest =
        guestId && share?.shareLinkId
            ? await client.listGuest.findFirst({ where: { id: guestId, shareLinkId: share.shareLinkId } })
            : null;
    return { list, share, guest, allowed: !!list && !!guest && share?.valid && share.access === "edit" };
};

export const load: PageServerLoad = async ({ params, url }) => {
    const $t = await getFormatter();
    // The guest id lives in session storage, so it is checked when the form is submitted.
    const list = await getByIdForAccess(params.id);
    const share = list && (await validateListShareToken(list, getShareTokenFromUrl(url)));
    if (!list || !share?.valid || share.access !== "edit") error(404, $t("errors.list-not-found"));
    return { listId: params.id, shareToken: getShareTokenFromUrl(url) };
};

export const actions: Actions = {
    default: async ({ request, params, url }) => {
        const $t = await getFormatter();
        const formData = await request.formData();
        const { list, allowed, guest } = await getAccess(
            params.id,
            getShareTokenFromUrl(url),
            String(formData.get("guestId") || "") || null
        );
        if (!list || !allowed || !guest) return fail(401, { message: $t("errors.not-authorized") });

        const parsed = (await getItemCreateSchema()).safeParse(extractFormData(formData));
        if (!parsed.success) return fail(422, { errors: z.flattenError(parsed.error).fieldErrors });
        const data = parsed.data;
        let imageUrl: string | null | undefined;
        if (data.image && isValidImage(data.image)) imageUrl = await createImage(data.name, data.image);
        else if (data.imageUrl) imageUrl = await createImage(data.name, data.imageUrl);

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
        const displayOrder = await getNextDisplayOrderForLists([params.id], data.mostWanted, data.optional);
        const item = await client.item.create({
            data: {
                userId: list.owner.id,
                createdById: list.owner.id,
                name: data.name,
                url: data.url,
                note: data.note,
                imageUrl,
                itemPriceId,
                quantity: data.quantity,
                optional: data.optional,
                mostWanted: data.mostWanted,
                pricePollingEnabled: false,
                lists: {
                    create: {
                        listId: params.id,
                        addedById: list.owner.id,
                        guestId: guest.id,
                        displayOrder: displayOrder[params.id]
                    }
                }
            },
            include: getItemInclusions(params.id)
        });
        itemEmitter.emit(ItemEvent.ITEM_CREATE, item);
        redirect(303, `/lists/${params.id}?share=${encodeURIComponent(getShareTokenFromUrl(url) || "")}`);
    }
};
