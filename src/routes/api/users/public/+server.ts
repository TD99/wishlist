import { client } from "$lib/server/prisma";
import { type RequestHandler } from "@sveltejs/kit";
import { getConfig } from "$lib/server/config";
import { error } from "@sveltejs/kit";
import { getFormatter } from "$lib/server/i18n";
import { createPublicUserSchema } from "$lib/server/validations";
import { prettifyError } from "zod";
import { getShareTokenFromRequest, validateListShareToken } from "$lib/server/share-link";

export const POST: RequestHandler = async ({ request, url }) => {
    const dataRaw = await request.json();

    const result = createPublicUserSchema.safeParse(dataRaw);
    if (!result.success) {
        const errorMessages = prettifyError(result.error);
        error(422, errorMessages);
    }
    const data = result.data;

    const list = await client.list.findUnique({
        select: {
            id: true,
            groupId: true,
            public: true,
            publicShareTokenHash: true
        },
        where: {
            id: data.listId
        }
    });

    const shareToken = getShareTokenFromRequest(request, url);
    const $t = await getFormatter();
    if (!list || !(await validateListShareToken(list, shareToken)).valid) {
        error(404, $t("errors.public-list-not-found"));
    }

    const config = await getConfig(list.groupId);
    if (!config.claims.allowAnonymous) {
        error(403, $t("errors.not-authorized"));
    }
    if (config.claims.requireEmail && !data.username) {
        error(422, $t("errors.email-is-required-for-public-claims"));
    }

    // If we have a username/email, try to find existing user first
    // otherwise lets create a new user for each claim
    if (data.username) {
        const user = await client.systemUser.findFirst({
            where: {
                username: data.username,
                name: data.name || "ANONYMOUS_NAME"
            },
            select: {
                id: true
            }
        });

        if (user) {
            return new Response(JSON.stringify(user));
        }
    }

    const user = await client.systemUser.create({
        select: {
            id: true
        },
        data: {
            username: data.username,
            name: data.name
        }
    });

    return new Response(JSON.stringify(user));
};
