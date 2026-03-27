import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireLoginOrError } from "$lib/server/auth";
import { getFormatter } from "$lib/server/i18n";
import { client } from "$lib/server/prisma";
import { getActiveMembership } from "$lib/server/group-membership";
import { createListShareToken, getListShareLinks } from "$lib/server/share-link";
import { getConfig } from "$lib/server/config";

const validateManagerAccess = async (listId: string, user: LocalUser, locale?: string) => {
    const $t = await getFormatter(locale);
    const list = await client.list.findUnique({
        select: {
            id: true,
            ownerId: true,
            groupId: true,
            public: true,
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

    return list;
};

export const GET: RequestHandler = async ({ params, locals }) => {
    const user = await requireLoginOrError();
    await validateManagerAccess(params.listId, user, locals.locale);

    const links = await getListShareLinks(params.listId);
    return new Response(
        JSON.stringify(
            links.map((link) => ({
                id: link.id,
                tokenHint: link.tokenHint,
                createdAt: link.createdAt,
                uniqueAccessorCount: link._count.accessors
            }))
        )
    );
};

export const POST: RequestHandler = async ({ params, locals }) => {
    const user = await requireLoginOrError();
    const $t = await getFormatter(locals.locale);
    const list = await validateManagerAccess(params.listId, user, locals.locale);

    const config = await getConfig(list.groupId);
    if (!list.public && config.listMode !== "registry" && !config.allowPublicLists) {
        error(422, $t("errors.public-lists-not-allowed"));
    }

    const { shareLink, token } = await createListShareToken(params.listId);
    return new Response(
        JSON.stringify({
            id: shareLink.id,
            tokenHint: shareLink.tokenHint,
            createdAt: shareLink.createdAt,
            uniqueAccessorCount: 0,
            shareToken: token
        }),
        { status: 201 }
    );
};
