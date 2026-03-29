import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getConfig } from "$lib/server/config";
import { getFormatter } from "$lib/server/i18n";
import { getByIdForAccess, getItems, type GetItemsOptions } from "$lib/server/list";
import { getActiveMembership } from "$lib/server/group-membership";
import type { UserGroupMembership } from "$lib/generated/prisma/client";
import {
    getListShareLinks,
    getShareTokenFromUrl,
    trackShareLinkAccess,
    validateListShareToken
} from "$lib/server/share-link";

export const load = (async ({ params, url, locals, depends, cookies }) => {
    const $t = await getFormatter();
    const shareToken = getShareTokenFromUrl(url);
    const user = locals.user;

    const list = await getByIdForAccess(params.id);
    const shareValidation = list
        ? await validateListShareToken(list, shareToken)
        : { valid: false, shareLinkId: undefined };
    const hasValidShareToken = shareValidation.valid;

    let activeMembership: UserGroupMembership | undefined;
    if (!user) {
        if (!list || !hasValidShareToken) {
            // Redirect to login so we don't expose details if the list does exist
            const redirectTo = url.pathname + url.search;
            const params = new URLSearchParams({ redirectTo });
            redirect(307, `/login?${params}`);
        }
    } else {
        activeMembership = await getActiveMembership(user);
        if (!list || (list.groupId !== activeMembership.groupId && !hasValidShareToken)) {
            error(404, $t("errors.list-not-found"));
        }
        if (
            list.groupId !== activeMembership.groupId &&
            (list.owner.id === user.id || list.managers.find(({ userId }) => userId === user.id))
        ) {
            error(401, $t("errors.user-must-be-in-the-correct-group"));
        }
    }

    if (hasValidShareToken) {
        await trackShareLinkAccess(cookies, shareValidation.shareLinkId);
    }

    const { publicShareTokenHash: _publicShareTokenHash, ...safeList } = list;
    const canManageShareLinks =
        !!user &&
        activeMembership?.groupId === safeList.groupId &&
        (safeList.owner.id === user.id || safeList.managers.find(({ userId }) => userId === user.id) !== undefined);
    const shareLinks = canManageShareLinks
        ? await getListShareLinks(safeList.id).then((links) =>
              links.map((link) => ({
                  id: link.id,
                  tokenHint: link.tokenHint,
                  createdAt: link.createdAt,
                  uniqueAccessorCount: link._count.accessors
              }))
          )
        : [];

    const config = await getConfig(list.groupId);

    const options: GetItemsOptions = {
        filter: url.searchParams.get("filter"),
        requirement: url.searchParams.get("requirement"),
        sort: url.searchParams.get("sort"),
        sortDir: url.searchParams.get("dir"),
        suggestionMethod: config.suggestions.method,
        listOwnerId: safeList.owner.id,
        listManagers: new Set(safeList.managers.map(({ userId }) => userId)),
        loggedInUserId: user?.id || null
    };

    const items = await getItems(safeList.id, options);

    depends("data:items");

    // Read view preference from cookie (for SSR to prevent flicker)
    const viewPreference = cookies.get("listViewPreference") as "list" | "tile" | undefined;

    return {
        list: {
            ...safeList,
            owner: {
                ...safeList.owner,
                isMe: safeList.owner.id === user?.id,
                activeGroupId: safeList.groupId
            },
            isManager: safeList.managers.find(({ userId }) => userId === user?.id) !== undefined,
            items
        },
        loggedInUser: user
            ? {
                  id: user.id,
                  username: user.username,
                  name: user.name,
                  activeGroupId: activeMembership!.groupId
              }
            : undefined,
        listMode: config.listMode,
        allowPublicLists: config.allowPublicLists,
        showClaimedName: config.claims.showName,
        showNameAcrossGroups: config.claims.showNameAcrossGroups,
        showClaimForOwner: config.claims.showForOwner,
        requireClaimEmail: config.claims.requireEmail,
        allowAnonymousClaims: config.claims.allowAnonymous,
        suggestionsEnabled: config.suggestions.enable,
        publicShareToken: hasValidShareToken && shareToken ? shareToken : undefined,
        shareLinks,
        initialViewPreference: viewPreference || "list"
    };
}) satisfies PageServerLoad;
