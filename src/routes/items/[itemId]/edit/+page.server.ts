import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { client } from "$lib/server/prisma";
import { getConfig } from "$lib/server/config";
import { getActiveMembership } from "$lib/server/group-membership";
import { createImage, isValidImage, tryDeleteImage } from "$lib/server/image-util";
import { itemEmitter } from "$lib/server/events/emitters";
import { getMinorUnits } from "$lib/price-formatter";
import { getFormatter, getLocale } from "$lib/server/i18n";
import { ItemEvent } from "$lib/events";
import { getItemInclusions } from "$lib/server/items";
import { getAvailableLists, getNextDisplayOrderForLists } from "$lib/server/list";
import { requireLogin } from "$lib/server/auth";
import { extractFormData, getItemUpdateSchema } from "$lib/server/validations";
import z from "zod";
import type { List, Prisma } from "$lib/generated/prisma/client";

export const load: PageServerLoad = async ({ params }) => {
    const user = requireLogin();

    const $t = await getFormatter();
    if (isNaN(parseInt(params.itemId))) {
        error(400, $t("errors.item-id-must-be-a-number"));
    }
    const itemId = parseInt(params.itemId);

    const activeMembership = await getActiveMembership(user);
    const config = await getConfig(activeMembership.groupId);

    const item = await client.item.findUnique({
        where: {
            id: itemId,
            lists: {
                some: {
                    list: {
                        groupId: activeMembership.groupId
                    }
                }
            }
        },
        include: {
            itemPrice: true,
            dependencies: {
                select: {
                    dependsOnId: true
                }
            },
            lists: {
                select: {
                    addedById: true,
                    list: {
                        select: {
                            id: true,
                            ownerId: true,
                            pricePollingEnabled: true,
                            managers: {
                                select: {
                                    userId: true
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    if (!item) error(404, $t("errors.item-not-found"));

    if (config.suggestions.method === "surprise" && user.id !== item.createdById) {
        error(401, $t("errors.cannot-edit-item-that-you-did-not-create"));
    }

    if (user.id !== item.userId && user.id !== item.createdById) {
        error(400, $t("errors.item-invalid-ownership", { values: { username: user.username } }));
    }

    const lists = await getAvailableLists(item.userId, user.id);
    const dependencyOptions = await client.item.findMany({
        select: {
            id: true,
            name: true,
            optional: true,
            mostWanted: true
        },
        where: {
            id: {
                not: itemId
            },
            userId: item.userId,
            lists: {
                some: {
                    listId: {
                        in: item.lists.map(({ list }) => list.id)
                    }
                }
            }
        },
        orderBy: [{ optional: "asc" }, { mostWanted: "desc" }, { name: "asc" }]
    });

    return {
        item: {
            ...item,
            dependencyIds: item.dependencies.map((dependency) => dependency.dependsOnId),
            lists: item.lists.map(({ list, addedById }) => ({
                id: list.id,
                canModify:
                    list.ownerId === user.id ||
                    addedById === user.id ||
                    list.managers.find(({ userId }) => userId === user.id) !== undefined
            }))
        },
        itemPollingDisabled: !item.pricePollingEnabled,
        listPricePollingEnabled: item.lists.some(({ list }) => list.pricePollingEnabled),
        dependencyOptions,
        lists
    };
};

export const actions: Actions = {
    default: async ({ request, params, url: requestUrl }) => {
        const user = requireLogin();
        const $t = await getFormatter();

        const itemFormSchema = await getItemUpdateSchema();
        const form = await request.formData().then(extractFormData).then(itemFormSchema.safeParse);

        if (!form.success) {
            return fail(400, { errors: z.flattenError(form.error).fieldErrors });
        }
        const {
            url,
            imageUrl,
            image,
            name,
            price,
            currency,
            quantity,
            note,
            lists,
            dependsOnIds,
            optional,
            mostWanted,
            disablePricePolling
        } = form.data;
        const itemId = parseInt(params.itemId);

        const item = await client.item.findUniqueOrThrow({
            include: {
                lists: {
                    select: {
                        id: true,
                        addedById: true,
                        displayOrder: true,
                        list: {
                            select: {
                                id: true,
                                ownerId: true
                            }
                        }
                    }
                }
            },
            where: {
                id: itemId
            }
        });

        let newImageFile: string | undefined | null;
        if (image && isValidImage(image)) {
            newImageFile = await createImage(name, image);
        } else if (imageUrl && item.imageUrl !== imageUrl) {
            newImageFile = await createImage(name, imageUrl);
        }

        let itemPriceId = null;
        if (price && currency) {
            await client.itemPrice
                .create({
                    data: {
                        value: getMinorUnits(parseFloat(price), currency, getLocale()),
                        currency
                    }
                })
                .then((itemPrice) => (itemPriceId = itemPrice.id));
        }

        const desiredLists = await client.list.findMany({
            select: {
                id: true,
                ownerId: true,
                groupId: true,
                pricePollingEnabled: true,
                managers: {
                    select: {
                        userId: true
                    }
                }
            },
            where: {
                id: {
                    in: lists
                }
            }
        });

        const desiredListIds = new Set(desiredLists.map(({ id }) => id));
        const hasPollingEnabledList = desiredLists.some((list) => list.pricePollingEnabled);
        const itemPricePollingEnabled = hasPollingEnabledList && !disablePricePolling;
        const sanitizedDependsOnIds = sanitizeDependencyIds(dependsOnIds);

        if (sanitizedDependsOnIds.includes(itemId)) {
            return fail(400, { errors: { dependsOnIds: [$t("errors.item-cannot-depend-on-itself")] } });
        }

        if (sanitizedDependsOnIds.length > 0) {
            const dependencies = await client.item.findMany({
                select: {
                    id: true,
                    optional: true
                },
                where: {
                    id: {
                        in: sanitizedDependsOnIds
                    },
                    userId: item.userId
                }
            });
            if (dependencies.length !== sanitizedDependsOnIds.length) {
                return fail(400, { errors: { dependsOnIds: [$t("errors.one-or-more-item-dependencies-invalid")] } });
            }
            if (dependencies.some((dependency) => dependency.optional !== optional)) {
                return fail(400, { errors: { dependsOnIds: [$t("errors.one-or-more-item-dependencies-invalid")] } });
            }
            const createsCycle = await wouldCreateDependencyCycle(itemId, sanitizedDependsOnIds);
            if (createsCycle) {
                return fail(400, { errors: { dependsOnIds: [$t("errors.item-dependency-cycle-detected")] } });
            }
        }

        const nextDisplayOrderByList = await getNextDisplayOrderForLists([...desiredListIds], mostWanted, optional);

        const listItemsToDelete = item.lists
            // only the list owner or the person who added the item can remove it from the list
            .filter(
                (listItem) =>
                    !desiredListIds.has(listItem.list.id) &&
                    (listItem.addedById === user.id || listItem.list.ownerId === user.id)
            )
            .map(({ id }) => id);

        const listItemsToCreate = await Promise.all(
            desiredLists
                // only create list items which are not already existing
                .filter((l) => item.lists.find(({ list }) => list.id === l.id) === undefined)
                .map(async (l) => {
                    const config = await getConfig(l.groupId);
                    return {
                        listId: l.id,
                        addedById: user.id,
                        approved: determineApprovalStatus(config, l, user),
                        displayOrder: nextDisplayOrderByList[l.id] || 0
                    };
                })
        );

        let listItemsToUpdate: Prisma.ListItemUpdateWithWhereUniqueWithoutItemInput[] | undefined = undefined;
        const requirementChanged = item.optional !== optional;
        // If item is newly most wanted, or moved between required/optional sections, update existing list item order.
        if (!item.mostWanted && mostWanted) {
            listItemsToUpdate = desiredLists
                // existing lists only
                .filter((l) => item.lists.find(({ list }) => list.id === l.id) !== undefined)
                .map((list) => ({
                    data: {
                        displayOrder: -1
                    },
                    where: {
                        listId_itemId: {
                            itemId,
                            listId: list.id
                        }
                    }
                }));
        } else if (requirementChanged) {
            listItemsToUpdate = desiredLists
                // existing lists only
                .filter((l) => item.lists.find(({ list }) => list.id === l.id) !== undefined)
                .map((list) => ({
                    data: {
                        displayOrder: nextDisplayOrderByList[list.id] || 0
                    },
                    where: {
                        listId_itemId: {
                            itemId,
                            listId: list.id
                        }
                    }
                }));
        }

        const updatedItem = await client.item.update({
            where: {
                id: itemId
            },
            data: {
                name,
                url,
                imageUrl: newImageFile,
                note,
                itemPriceId,
                quantity,
                optional,
                mostWanted,
                pricePollingEnabled: itemPricePollingEnabled,
                nextPricePollAt:
                    itemPricePollingEnabled && url
                        ? !item.pricePollingEnabled || item.url !== url
                            ? new Date()
                            : undefined
                        : null,
                dependencies: {
                    deleteMany: {},
                    ...(sanitizedDependsOnIds.length > 0
                        ? {
                              createMany: {
                                  data: sanitizedDependsOnIds.map((dependsOnId) => ({ dependsOnId }))
                              }
                          }
                        : {})
                },
                lists: {
                    create: listItemsToCreate,
                    update: listItemsToUpdate,
                    deleteMany: {
                        id: {
                            in: listItemsToDelete
                        }
                    }
                }
            },
            include: getItemInclusions()
        });

        if (item.itemPriceId !== null && item.itemPriceId !== itemPriceId) {
            await client.itemPrice.delete({
                where: {
                    id: item.itemPriceId
                }
            });
        }

        itemEmitter.emit(ItemEvent.ITEM_UPDATE, updatedItem);

        // if the image is not undefined, then it either was just created or it's null, which indicates the user removed it
        if (newImageFile !== undefined && item.imageUrl) {
            await tryDeleteImage(item.imageUrl);
        }

        const redirectTo = requestUrl.searchParams.get("redirectTo");
        redirect(302, redirectTo || "/");
    }
};

interface PartialList extends Pick<List, "id" | "groupId" | "ownerId"> {
    managers: { userId: string }[];
}

const determineApprovalStatus = (config: Config, list: PartialList, user: LocalUser) => {
    if (list.ownerId === user.id || config.suggestions.method !== "approval") {
        return true;
    }

    return list.managers.some(({ userId }) => userId === user.id);
};

const sanitizeDependencyIds = (dependencyIds: number[]) => {
    return [...new Set(dependencyIds)];
};

const wouldCreateDependencyCycle = async (itemId: number, dependencyIds: number[]) => {
    const seen = new Set<number>();
    let frontier = [...dependencyIds];

    while (frontier.length > 0) {
        const checkIds = frontier.filter((id) => !seen.has(id));
        if (checkIds.length === 0) {
            return false;
        }
        checkIds.forEach((id) => seen.add(id));

        const downstreamLinks = await client.itemDependency.findMany({
            select: {
                dependsOnId: true
            },
            where: {
                itemId: {
                    in: checkIds
                }
            }
        });

        if (downstreamLinks.some(({ dependsOnId }) => dependsOnId === itemId)) {
            return true;
        }

        frontier = downstreamLinks.map(({ dependsOnId }) => dependsOnId);
    }

    return false;
};
