import { client } from "$lib/server/prisma";
import { publicListCreateSchema } from "$lib/server/validations";
import { error } from "@sveltejs/kit";
import { getConfig } from "$lib/server/config";
import { getFormatter } from "$lib/server/i18n";
import type { Prisma } from "$lib/generated/prisma/client";
import type { RequestHandler } from "./$types";
import { requireLoginOrError } from "$lib/server/auth";
import { getActiveMembership } from "$lib/server/group-membership";
import { createListShareToken, deleteAllListShareLinks } from "$lib/server/share-link";

export const PATCH: RequestHandler = async ({ request, params }) => {
    const user = await requireLoginOrError();
    const $t = await getFormatter();

    const list = await client.list.findUnique({
        select: {
            id: true,
            public: true,
            groupId: true,
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
    }
    if (list.ownerId !== user.id && !list.managers.find(({ userId }) => userId === user.id)) {
        error(401, $t("errors.not-authorized"));
    }

    const activeMembership = await getActiveMembership(user);
    if (activeMembership.groupId !== list.groupId) {
        error(401, $t("errors.user-must-be-in-the-correct-group"));
    }

    const data = await request.json().then(publicListCreateSchema.safeParse);

    if (!data.success) {
        error(422, data.error.message);
    }

    const { public: publicList, regenerateShareToken } = data.data;
    const config = await getConfig(list.groupId);
    if (publicList === true && !list.public && config.listMode !== "registry" && !config.allowPublicLists) {
        error(422, $t("errors.public-lists-not-allowed"));
    }

    const updateData: Prisma.ListUpdateInput = {};
    if (publicList !== undefined) updateData.public = publicList;
    if (publicList === false) {
        updateData.publicShareTokenHash = null;
        updateData.publicShareTokenCreatedAt = null;
    }

    let shareToken: string | undefined;
    const shouldGenerateShareToken = publicList === true && (regenerateShareToken || !list.public);
    if (shouldGenerateShareToken) {
        shareToken = (await createListShareToken(params.listId)).token;
    } else if (Object.keys(updateData).length > 0) {
        await client.list.update({
            where: {
                id: params.listId
            },
            data: updateData
        });
        if (publicList === false) {
            await deleteAllListShareLinks(params.listId);
        }
    }

    const updatedList = await client.list.findUnique({
        select: {
            id: true,
            public: true
        },
        where: {
            id: params.listId
        }
    });
    if (!updatedList) {
        error(404, $t("errors.list-not-found"));
    }

    return new Response(JSON.stringify({ ...updatedList, shareToken }), { status: 200 });
};
