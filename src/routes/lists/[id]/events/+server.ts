import { itemEmitter } from "$lib/server/events/emitters";
import { createSSE } from "$lib/server/events/sse";
import type { RequestHandler } from "./$types";
import { error } from "@sveltejs/kit";
import { getConfig } from "$lib/server/config";
import { getFormatter } from "$lib/server/i18n";
import { getByIdForAccess } from "$lib/server/list";
import { getActiveMembership } from "$lib/server/group-membership";
import { ItemCreateHandler, ItemDeleteHandler, ItemsUpdateHandler, ItemUpdateHandler } from "$lib/events";
import { getShareTokenFromUrl, validateListShareToken } from "$lib/server/share-link";

export const GET = (async ({ locals, params, url }) => {
    const $t = await getFormatter();
    const shareToken = getShareTokenFromUrl(url);

    const list = await getByIdForAccess(params.id);
    const hasValidShareToken = !!list && (await validateListShareToken(list, shareToken)).valid;

    if (!locals.user) {
        if (!list || !hasValidShareToken) {
            return new Response();
        }
    } else {
        const activeMembership = await getActiveMembership(locals.user);
        if (!list || (list.groupId !== activeMembership.groupId && !hasValidShareToken)) {
            error(404, $t("errors.list-not-found"));
        }
    }

    const config = await getConfig(list.groupId);

    // don't do updates on the list owners page for surprise mode since an item could be added that the owner shouldn't see
    if (
        config.suggestions.enable &&
        config.suggestions.method === "surprise" &&
        locals.user &&
        (list.owner.id === locals.user.id || list.managers.find(({ userId }) => userId === locals.user!.id))
    ) {
        return new Response();
    }

    const { readable, subscribeToEvent } = createSSE();

    subscribeToEvent(itemEmitter, new ItemUpdateHandler(params.id));
    subscribeToEvent(itemEmitter, new ItemCreateHandler(params.id));
    subscribeToEvent(itemEmitter, new ItemDeleteHandler(params.id));
    subscribeToEvent(itemEmitter, new ItemsUpdateHandler(params.id));

    return new Response(readable, {
        headers: {
            "Cache-Control": "no-cache",
            "Content-Type": "text/event-stream",
            "X-Accel-Buffering": "no"
        }
    });
}) satisfies RequestHandler;
