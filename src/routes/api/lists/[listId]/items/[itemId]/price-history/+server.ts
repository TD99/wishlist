import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { client } from "$lib/server/prisma";
import { getFormatter } from "$lib/server/i18n";
import { getActiveMembership } from "$lib/server/group-membership";
import { getShareTokenFromRequest, validateListShareToken } from "$lib/server/share-link";

const MAX_HISTORY_POINTS = 180;

export const GET: RequestHandler = async ({ locals, request, url, params }) => {
    const $t = await getFormatter(locals.locale);
    const itemId = Number.parseInt(params.itemId, 10);
    if (!Number.isFinite(itemId)) {
        error(400, $t("errors.item-id-must-be-a-number"));
    }

    const list = await client.list.findUnique({
        select: {
            id: true,
            groupId: true,
            public: true,
            publicShareTokenHash: true
        },
        where: {
            id: params.listId
        }
    });
    if (!list) {
        error(404, $t("errors.list-not-found"));
    }

    const shareToken = getShareTokenFromRequest(request, url);
    const hasValidShareToken = (await validateListShareToken(list, shareToken)).valid;

    if (!locals.user) {
        if (!hasValidShareToken) {
            error(404, $t("errors.public-list-not-found"));
        }
    } else {
        const activeMembership = await getActiveMembership(locals.user);
        if (activeMembership.groupId !== list.groupId && !hasValidShareToken) {
            error(404, $t("errors.list-not-found"));
        }
    }

    const item = await client.item.findUnique({
        select: {
            id: true,
            pricePollingEnabled: true,
            lastPricePolledAt: true,
            nextPricePollAt: true,
            itemPrice: {
                select: {
                    value: true,
                    currency: true
                }
            },
            priceHistory: {
                select: {
                    value: true,
                    currency: true,
                    polledAt: true
                },
                orderBy: {
                    polledAt: "desc"
                },
                take: MAX_HISTORY_POINTS
            }
        },
        where: {
            id: itemId,
            lists: {
                some: {
                    listId: list.id
                }
            }
        }
    });
    if (!item) {
        error(404, $t("errors.item-not-found-on-list"));
    }

    return new Response(
        JSON.stringify({
            pricePollingEnabled: item.pricePollingEnabled,
            lastPricePolledAt: item.lastPricePolledAt,
            nextPricePollAt: item.nextPricePollAt,
            currentPrice: item.itemPrice,
            points: [...item.priceHistory].reverse()
        })
    );
};
