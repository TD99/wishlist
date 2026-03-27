import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireLoginOrError } from "$lib/server/auth";
import { getFormatter } from "$lib/server/i18n";
import { client } from "$lib/server/prisma";
import { getActiveMembership } from "$lib/server/group-membership";
import { deleteListShareLink } from "$lib/server/share-link";

const validateManagerAccess = async (listId: string, user: LocalUser, locale?: string) => {
    const $t = await getFormatter(locale);
    const list = await client.list.findUnique({
        select: {
            id: true,
            ownerId: true,
            groupId: true,
            managers: {
                select: {
                    userId: true
                }
            }
        },
        where: {
            id: listId
        }
    });
    if (!list) {
        error(404, $t("errors.list-not-found"));
    }
    if (list.ownerId !== user.id && !list.managers.find(({ userId }) => userId === user.id)) {
        error(401, $t("errors.not-authorized"));
    }

    const activeMembership = await getActiveMembership(user);
    if (activeMembership.groupId !== list.groupId) {
        error(401, $t("errors.user-must-be-in-the-correct-group"));
    }
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
    const user = await requireLoginOrError();
    const $t = await getFormatter(locals.locale);

    await validateManagerAccess(params.listId, user, locals.locale);
    const result = await deleteListShareLink(params.listId, params.shareLinkId);
    if (result.count === 0) {
        error(404, $t("errors.public-list-not-found"));
    }

    return new Response(null, { status: 204 });
};
