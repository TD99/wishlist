<script lang="ts">
    import type { PageProps } from "./$types";
    import ItemCard from "$lib/components/wishlists/ItemCard/ItemCard.svelte";
    import ClaimFilterChip from "$lib/components/wishlists/chips/ClaimFilter.svelte";
    import RequirementFilterChip from "$lib/components/wishlists/chips/RequirementFilter.svelte";
    import { goto, invalidate } from "$app/navigation";
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import { flip } from "svelte/animate";
    import { quintOut } from "svelte/easing";
    import { crossfade } from "svelte/transition";
    import { isInstalled } from "$lib/stores/is-installed";
    import empty from "$lib/assets/no_wishes.svg";
    import SortBy from "$lib/components/wishlists/chips/SortBy.svelte";
    import { hash, hashItems, viewedItems } from "$lib/stores/viewed-items";
    import { getListViewPreference, initListViewPreference } from "$lib/stores/list-view-preference.svelte";
    import { ListAPI, type ShareLinkSummary } from "$lib/api/lists";
    import TokenCopy from "$lib/components/TokenCopy.svelte";
    import { dragHandleZone, type DndZoneAttributes, type Item, type Options } from "svelte-dnd-action";
    import ReorderChip from "$lib/components/wishlists/chips/ReorderChip.svelte";
    import ManageListChip from "$lib/components/wishlists/chips/ManageListChip.svelte";
    import ListViewModeChip from "$lib/components/wishlists/chips/ListViewModeChip.svelte";
    import type { ItemOnListDTO } from "$lib/dtos/item-dto";
    import { ItemCreateHandler, ItemDeleteHandler, ItemsUpdateHandler, ItemUpdateHandler } from "$lib/events";
    import { getFormatter } from "$lib/i18n";
    import Markdown from "$lib/components/Markdown.svelte";
    import ListStatistics from "$lib/components/wishlists/ListStatistics.svelte";
    import ListDistributionModal from "$lib/components/wishlists/ListDistributionModal.svelte";
    import type { ActionReturn } from "svelte/action";
    import { toaster } from "$lib/components/toaster";
    import { orderItemsByDependencies } from "$lib/dependency-order";

    const { data }: PageProps = $props();
    const t = getFormatter();

    // svelte-ignore state_referenced_locally
    let allItems: ItemOnListDTO[] = $state(data.list.items);
    let reordering = $state(false);
    let publicListUrl: URL | undefined = $state();
    let approvals = $derived(allItems.filter((item) => !item.approved));
    let items = $derived(allItems.filter((item) => item.approved));
    let requiredOrdering = $derived(orderItemsByDependencies(items.filter((item) => !item.optional)));
    let optionalOrdering = $derived(orderItemsByDependencies(items.filter((item) => item.optional)));
    let requiredItems = $derived(requiredOrdering.items);
    let optionalItems = $derived(optionalOrdering.items);
    let showRequirementSections = $derived(requiredItems.length > 0 && optionalItems.length > 0);
    let listName = $derived.by(() => {
        if (data.list.name) {
            return data.list.name;
        } else if (data.list.owner.isMe) {
            return $t("wishes.my-wishes");
        } else {
            return $t("wishes.wishes-for", { values: { listOwner: data.list.owner.name } });
        }
    });
    let hideDescription = $state(false);
    let isGuestView = $derived(!data.loggedInUser);
    let publicShareToken = $derived(data.publicShareToken || undefined);
    let shareLinks: ShareLinkSummary[] = $state(data.shareLinks || []);
    let canManageList = $derived(data.list.owner.isMe || data.list.isManager);

    // Initialize from server data (cookie) to prevent flicker
    // This value comes from the server, so SSR renders the correct view
    // svelte-ignore state_referenced_locally
    initListViewPreference(data.initialViewPreference);
    let isTileView = $derived(getListViewPreference() === "tile");

    const flipDurationMs = 200;
    const listAPI = $derived(new ListAPI(data.list.id));

    const [send, receive] = crossfade({
        duration: (d) => Math.sqrt(d * 200),

        fallback(node) {
            const style = getComputedStyle(node);
            const transform = style.transform === "none" ? "" : style.transform;

            return {
                duration: 600,
                easing: quintOut,
                css: (t) => `
					transform: ${transform} scale(${t});
					opacity: ${t}
				`
            };
        }
    });

    onMount(async () => {
        await updateHash();
    });

    onMount(() => {
        if (publicShareToken) {
            setPublicListUrl(publicShareToken);
        }
    });

    onMount(() => {
        if (canManageList) {
            void refreshShareLinks();
        }
    });

    onMount(() => {
        const eventSource = subscribeToEvents();
        return () => eventSource.close();
    });

    $effect(() => {
        allItems = data.list.items;
    });

    const setApprovedItems = (updatedApprovedItems: ItemOnListDTO[]) => {
        const unapprovedItems = allItems.filter((item) => !item.approved);
        allItems = [...unapprovedItems, ...updatedApprovedItems];
    };

    const updateDisplayOrder = (approvedItems: ItemOnListDTO[]) => {
        approvedItems.filter((item) => !item.optional).forEach((item, idx) => (item.displayOrder = idx));
        approvedItems.filter((item) => item.optional).forEach((item, idx) => (item.displayOrder = idx));
    };

    const groupByClaimState = (items: ItemOnListDTO[]) => {
        // When on own list, don't separate out claimed vs un-claimed
        if (data.list.owner.isMe) {
            return [items, []];
        }
        return items.reduce(
            (g, v) => {
                const userHasClaimed = v.claims.find(
                    (c) => data.loggedInUser?.id && c.claimedBy?.id === data.loggedInUser.id
                );
                if (v.isClaimable && !userHasClaimed) {
                    g[0].push(v);
                } else {
                    g[1].push(v);
                }
                return g;
            },
            [[], []] as ItemOnListDTO[][]
        );
    };

    const mergeApprovedItems = (required: ItemOnListDTO[], optional: ItemOnListDTO[]) => {
        const merged = [...required, ...optional];
        updateDisplayOrder(merged);
        setApprovedItems(merged);
    };

    const updateOptionalGroup = (optional: boolean, updatedGroup: ItemOnListDTO[]) => {
        const approvedItems = allItems.filter((item) => item.approved);
        const otherGroup = approvedItems.filter((item) => item.optional !== optional);
        if (optional) {
            mergeApprovedItems(otherGroup, updatedGroup);
        } else {
            mergeApprovedItems(updatedGroup, otherGroup);
        }
    };

    const updateHash = async () => {
        const userHash = await hash(data.list.id);
        viewedItems.current[userHash] = await hashItems(allItems);
    };

    const subscribeToEvents = () => {
        const eventsUrl = new URL(`${page.url.pathname}/events`, window.location.origin);
        if (publicShareToken) {
            eventsUrl.searchParams.set("share", publicShareToken);
        }
        const eventSource = new EventSource(eventsUrl.toString());
        ItemUpdateHandler.listen(eventSource, (data) => {
            updateItem(data);
            updateHash();
        });
        ItemCreateHandler.listen(eventSource, (data) => {
            addItem(data);
            updateHash();
        });
        ItemDeleteHandler.listen(eventSource, (data) => {
            removeItem(data);
            updateHash();
        });
        ItemsUpdateHandler.listen(eventSource, () => {
            if (!data.list.owner.isMe) {
                invalidate("data:items");
                updateHash();
            }
        });
        return eventSource;
    };

    const setPublicListUrl = (shareToken: string) => {
        const url = new URL(`/lists/${data.list.id}`, window.location.origin);
        url.searchParams.set("share", shareToken);
        publicListUrl = url;
    };

    const formatShareLinkDate = (createdAt: string | Date) => {
        return new Date(createdAt).toLocaleString();
    };

    const refreshShareLinks = async () => {
        if (!canManageList) {
            return;
        }

        const response = await listAPI.getShareLinks();
        if (!response.ok) {
            return;
        }

        shareLinks = (await response.json()) as ShareLinkSummary[];
    };

    const updateItem = (updatedItem: ItemOnListDTO) => {
        // for when an item gets approved
        if (!allItems.find((item) => item.id === updatedItem.id)) {
            addItem(updatedItem);
        }
        allItems = allItems.map((item) => {
            if (item.id === updatedItem.id) {
                return { ...item, ...updatedItem };
            }
            return item;
        });
    };

    const removeItem = (removedItem: { id: number }) => {
        allItems = allItems.filter((item) => item.id !== removedItem.id);
    };

    const addItem = (addedItem: ItemOnListDTO) => {
        if (!(addedItem.approved || data.list.owner.isMe)) {
            return;
        }
        allItems = [...allItems, addedItem];
    };

    const getOrCreatePublicList = async () => {
        const resp = await listAPI.generateShareLink();
        if (!resp.ok) {
            const description = await resp.text();
            toaster.error({ description });
            return;
        }

        const responseData = (await resp.json()) as ShareLinkSummary & { shareToken?: string };
        if (!responseData.shareToken) {
            toaster.error({ description: $t("general.oops") });
            return;
        }

        shareLinks = [responseData, ...shareLinks.filter((link) => link.id !== responseData.id)];
        setPublicListUrl(responseData.shareToken);
        void refreshShareLinks();
    };

    const deleteShareLink = async (shareLinkId: string) => {
        const response = await listAPI.deleteShareLink(shareLinkId);
        if (!response.ok) {
            toaster.error({ description: $t("general.oops") });
            return;
        }

        const currentShareToken = publicListUrl?.searchParams.get("share");
        if (currentShareToken?.startsWith(`${shareLinkId}.`)) {
            publicListUrl = undefined;
        }

        shareLinks = shareLinks.filter((link) => link.id !== shareLinkId);
        void refreshShareLinks();
    };

    // custom dnd action to remove the aria disabled flag
    function dndZone<T extends Item>(
        node: HTMLElement,
        options: Options<T>
    ): ActionReturn<Options<T>, DndZoneAttributes<T>> {
        const zone = dragHandleZone(node, options);
        node.setAttribute("aria-disabled", "false");
        return {
            update(newOptions) {
                zone.update?.(newOptions);
                node.setAttribute("aria-disabled", "false");
            },
            destroy: zone.destroy
        };
    }
    const handleDnd = (optional: boolean, e: CustomEvent<{ items: ItemOnListDTO[] }>) => {
        updateOptionalGroup(optional, e.detail.items);
    };

    const getDependencyLevel = (item: ItemOnListDTO) => {
        return item.optional
            ? (optionalOrdering.levels.get(item.id) ?? 0)
            : (requiredOrdering.levels.get(item.id) ?? 0);
    };
    const swap = (arr: ItemOnListDTO[], a: number, b: number): ItemOnListDTO[] => {
        const swapped = arr.with(a, arr[b]).with(b, arr[a]);
        return swapped;
    };
    const handleIncreasePriority = (itemId: number) => {
        const item = items.find((it) => it.id === itemId);
        if (!item) {
            return;
        }
        const groupedItems = item.optional ? optionalItems : requiredItems;
        const itemIdx = groupedItems.findIndex((it) => it.id === itemId);
        if (itemIdx > 0) {
            updateOptionalGroup(item.optional, swap(groupedItems, itemIdx, itemIdx - 1));
        }
    };
    const handleDecreasePriority = (itemId: number) => {
        const item = items.find((it) => it.id === itemId);
        if (!item) {
            return;
        }
        const groupedItems = item.optional ? optionalItems : requiredItems;
        const itemIdx = groupedItems.findIndex((it) => it.id === itemId);
        if (itemIdx < groupedItems.length - 1) {
            updateOptionalGroup(item.optional, swap(groupedItems, itemIdx, itemIdx + 1));
        }
    };
    const handlePriorityInput = (item: ItemOnListDTO, idxString: string) => {
        const groupedItems = item.optional ? optionalItems : requiredItems;
        const targetIdx = Number.parseInt(idxString) - 1;
        const currentIdx = groupedItems.findIndex((it) => it.id === item.id);

        if (Number.isNaN(targetIdx) || targetIdx < 0 || targetIdx > groupedItems.length - 1) {
            toaster.error({
                description: $t("errors.display-order-invalid", { values: { min: 1, max: groupedItems.length } })
            });
            const el = document.getElementById(`${item.id}-displayOrder`) as HTMLInputElement;
            el.value = ((item.displayOrder ?? 0) + 1).toString();
            return;
        }
        if (currentIdx !== targetIdx) {
            const resortedItems: ItemOnListDTO[] = [];
            let displayOrder = 0;
            for (let i = 0; i < groupedItems.length; i++) {
                if (i === currentIdx) {
                    continue;
                }
                if (i === targetIdx) {
                    if (targetIdx < currentIdx) {
                        resortedItems.push(groupedItems[currentIdx]);
                        resortedItems.push(groupedItems[i]);
                    } else {
                        resortedItems.push(groupedItems[i]);
                        resortedItems.push(groupedItems[currentIdx]);
                    }

                    resortedItems.at(-2)!.displayOrder = displayOrder++;
                } else {
                    resortedItems.push(groupedItems[i]);
                }
                resortedItems.at(-1)!.displayOrder = displayOrder++;
            }
            updateOptionalGroup(item.optional, resortedItems);
        }
    };
    const handleReorderFinalize = async () => {
        reordering = false;
        const displayOrderUpdate = items.map((item) => ({
            itemId: item.id,
            displayOrder: item.displayOrder ?? 0
        }));
        const response = await listAPI.updateItems(displayOrderUpdate);
        if (!response.ok) {
            toaster.error({ description: $t("wishes.unable-to-update-item-ordering") });
            allItems = data.list.items;
        }
    };
</script>

{#if data.list.description}
    <div class="w-full pb-4">
        {#if !hideDescription}
            <Markdown source={data.list.description} />
        {/if}
        <button
            class="text-primary-700 dark:text-primary-500 text-sm print:hidden"
            onclick={() => (hideDescription = !hideDescription)}
        >
            {hideDescription ? $t("wishes.show-description") : $t("wishes.hide-description")}
        </button>
    </div>
{/if}

<!-- chips -->
<div class="flex flex-wrap items-end justify-between gap-2 pb-4 print:hidden">
    <div class="flex flex-row flex-wrap items-end gap-2">
        <RequirementFilterChip />
        {#if !data.list.owner.isMe}
            <ClaimFilterChip />
        {/if}
        <SortBy />
    </div>
    <div class="flex flex-row flex-wrap items-end gap-2">
        {#if !reordering}
            <ListViewModeChip {isTileView} />
        {/if}
        {#if data.list.owner.isMe || data.list.isManager}
            <ReorderChip onFinalize={handleReorderFinalize} bind:reordering />
            <ManageListChip onclick={() => goto(`${new URL(page.url).pathname}/manage`)} />
        {/if}
    </div>
</div>

<div class="flex flex-wrap-reverse items-start justify-between gap-2 pb-4 print:hidden">
    <div class="flex items-start gap-2">
        <ListStatistics {items} />
        <ListDistributionModal {items}>
            {#snippet trigger(triggerProps)}
                <button
                    {...triggerProps}
                    aria-label={$t("wishes.list-distribution")}
                    class="btn btn-icon btn-icon-sm md:btn-icon-base inset-ring-surface-500 inset-ring"
                    onclick={(event) => {
                        event.stopPropagation();
                        triggerProps.onclick?.(event);
                    }}
                    title={$t("wishes.list-distribution")}
                    type="button"
                >
                    <iconify-icon icon="ion:pie-chart"></iconify-icon>
                </button>
            {/snippet}
        </ListDistributionModal>
    </div>
    {#if data.list.owner.isMe || data.list.isManager}
        {#if data.listMode === "registry" || data.allowPublicLists || data.list.public}
            <div class="flex flex-row gap-x-2">
                {#if publicListUrl}
                    <TokenCopy btnStyle="btn-xs" url={publicListUrl?.href}>
                        <span class="text-sm">{$t("wishes.public-url")}</span>
                    </TokenCopy>
                {:else}
                    <button class="btn btn-xs inset-ring-surface-500 inset-ring" onclick={getOrCreatePublicList}>
                        {$t("wishes.share")}
                    </button>
                {/if}
            </div>
        {/if}
    {/if}
</div>

{#if data.list.owner.isMe || data.list.isManager}
    <div class="rounded-container border-surface-500 mb-4 flex flex-col gap-2 border p-3 print:hidden">
        <h3 class="text-base font-semibold">{$t("wishes.shared-links")}</h3>
        {#if shareLinks.length === 0}
            <p class="subtext">{$t("wishes.no-shared-links")}</p>
        {:else}
            <div class="flex flex-col gap-2">
                {#each shareLinks as link (link.id)}
                    <div class="rounded-base bg-surface-100-900 flex items-center justify-between gap-2 p-2">
                        <div class="min-w-0">
                            <p class="font-mono text-xs">
                                {$t("wishes.shared-link-hint", { values: { hint: link.tokenHint } })}
                            </p>
                            <p class="subtext text-xs">
                                {$t("wishes.shared-link-meta", {
                                    values: {
                                        createdAt: formatShareLinkDate(link.createdAt),
                                        accessorCount: link.uniqueAccessorCount
                                    }
                                })}
                            </p>
                        </div>
                        <button class="btn btn-xs" onclick={() => deleteShareLink(link.id)} type="button">
                            {$t("general.remove")}
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}

{#if (data.list.owner.isMe || data.list.isManager) && approvals.length > 0}
    <div class="flex flex-col space-y-4 pb-4 print:hidden">
        <h2 class="h2">{$t("wishes.approvals")}</h2>
        <div
            class={isTileView
                ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                : "flex flex-col space-y-4"}
            data-testid="approvals-container"
        >
            {#each approvals as item (item.id)}
                <div in:receive={{ key: item.id }} out:send|local={{ key: item.id }} animate:flip={{ duration: 200 }}>
                    <ItemCard
                        groupId={data.list.groupId}
                        {isTileView}
                        {item}
                        onPublicList={isGuestView}
                        {publicShareToken}
                        allowAnonymousClaims={data.allowAnonymousClaims}
                        requireClaimEmail={data.requireClaimEmail}
                        showClaimForOwner={data.showClaimForOwner}
                        showClaimedName={data.showClaimedName}
                        showNameAcrossGroups={data.showNameAcrossGroups}
                        user={data.loggedInUser}
                        userCanManage={data.list.isManager}
                    />
                </div>
            {/each}
        </div>
        <hr class="hr" />
    </div>
{/if}

{#if items.length === 0}
    <div class="flex flex-col items-center justify-center space-y-4 pt-2">
        <img class="w-3/4 md:w-1/3" alt={$t("a11y.two-people-looking-in-an-empty-box")} src={empty} />
        <p class="text-2xl">{$t("wishes.no-wishes-yet")}</p>
    </div>
{:else}
    <div data-testid="items-container">
        {#if requiredItems.length > 0}
            <section class={["pb-4", showRequirementSections && "rounded-container border-surface-500 border p-3"]}>
                {#if showRequirementSections}
                    <h2 class="h3 pb-3">{$t("wishes.required")}</h2>
                {/if}
                {#if reordering}
                    <div
                        class={isTileView
                            ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                            : "flex flex-col space-y-4"}
                        data-testid="required-items-container"
                        onconsider={(e) => handleDnd(false, e)}
                        onfinalize={(e) => handleDnd(false, e)}
                        use:dndZone={{
                            items: requiredItems,
                            flipDurationMs,
                            dragDisabled: false,
                            dropTargetClasses: ["preset-outlined-primary-500"],
                            dropTargetStyle: {}
                        }}
                    >
                        {#each requiredItems as item (item.id)}
                            <div
                                class={!isTileView ? "dependency-node" : undefined}
                                data-dependency-level={!isTileView ? getDependencyLevel(item) : undefined}
                                style={!isTileView ? `--dependency-level:${getDependencyLevel(item)};` : undefined}
                                animate:flip={{ duration: flipDurationMs }}
                            >
                                <ItemCard
                                    groupId={data.list.groupId}
                                    {isTileView}
                                    {item}
                                    onDecreasePriority={handleDecreasePriority}
                                    onIncreasePriority={handleIncreasePriority}
                                    onPriorityChange={handlePriorityInput}
                                    onPublicList={isGuestView}
                                    {publicShareToken}
                                    allowAnonymousClaims={data.allowAnonymousClaims}
                                    reorderActions
                                    requireClaimEmail={data.requireClaimEmail}
                                    showClaimForOwner={data.showClaimForOwner}
                                    showClaimedName={data.showClaimedName}
                                    showNameAcrossGroups={data.showNameAcrossGroups}
                                    user={data.loggedInUser}
                                    userCanManage={data.list.isManager}
                                />
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div
                        class={isTileView
                            ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                            : "flex flex-col space-y-4"}
                        data-testid="required-items-container"
                    >
                        {#each groupByClaimState(requiredItems) as groupedItems}
                            {#each groupedItems as item (item.id)}
                                <div
                                    class={!isTileView ? "dependency-node" : undefined}
                                    data-dependency-level={!isTileView ? getDependencyLevel(item) : undefined}
                                    style={!isTileView ? `--dependency-level:${getDependencyLevel(item)};` : undefined}
                                    in:receive={{ key: item.id }}
                                    out:send|local={{ key: item.id }}
                                    animate:flip={{ duration: flipDurationMs }}
                                >
                                    <ItemCard
                                        groupId={data.list.groupId}
                                        {isTileView}
                                        {item}
                                        onPublicList={isGuestView}
                                        {publicShareToken}
                                        allowAnonymousClaims={data.allowAnonymousClaims}
                                        requireClaimEmail={data.requireClaimEmail}
                                        showClaimForOwner={data.showClaimForOwner}
                                        showClaimedName={data.showClaimedName}
                                        showNameAcrossGroups={data.showNameAcrossGroups}
                                        user={data.loggedInUser}
                                        userCanManage={data.list.isManager}
                                    />
                                </div>
                            {/each}
                        {/each}
                    </div>
                {/if}
            </section>
        {/if}

        {#if optionalItems.length > 0}
            <section class={["pb-4", showRequirementSections && "rounded-container border-surface-500 border p-3"]}>
                {#if showRequirementSections}
                    <h2 class="h3 pb-3">{$t("wishes.optional")}</h2>
                {/if}
                {#if reordering}
                    <div
                        class={isTileView
                            ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                            : "flex flex-col space-y-4"}
                        data-testid="optional-items-container"
                        onconsider={(e) => handleDnd(true, e)}
                        onfinalize={(e) => handleDnd(true, e)}
                        use:dndZone={{
                            items: optionalItems,
                            flipDurationMs,
                            dragDisabled: false,
                            dropTargetClasses: ["preset-outlined-primary-500"],
                            dropTargetStyle: {}
                        }}
                    >
                        {#each optionalItems as item (item.id)}
                            <div
                                class={!isTileView ? "dependency-node" : undefined}
                                data-dependency-level={!isTileView ? getDependencyLevel(item) : undefined}
                                style={!isTileView ? `--dependency-level:${getDependencyLevel(item)};` : undefined}
                                animate:flip={{ duration: flipDurationMs }}
                            >
                                <ItemCard
                                    groupId={data.list.groupId}
                                    {isTileView}
                                    {item}
                                    onDecreasePriority={handleDecreasePriority}
                                    onIncreasePriority={handleIncreasePriority}
                                    onPriorityChange={handlePriorityInput}
                                    onPublicList={isGuestView}
                                    {publicShareToken}
                                    allowAnonymousClaims={data.allowAnonymousClaims}
                                    reorderActions
                                    requireClaimEmail={data.requireClaimEmail}
                                    showClaimForOwner={data.showClaimForOwner}
                                    showClaimedName={data.showClaimedName}
                                    showNameAcrossGroups={data.showNameAcrossGroups}
                                    user={data.loggedInUser}
                                    userCanManage={data.list.isManager}
                                />
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div
                        class={isTileView
                            ? "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                            : "flex flex-col space-y-4"}
                        data-testid="optional-items-container"
                    >
                        {#each groupByClaimState(optionalItems) as groupedItems}
                            {#each groupedItems as item (item.id)}
                                <div
                                    class={!isTileView ? "dependency-node" : undefined}
                                    data-dependency-level={!isTileView ? getDependencyLevel(item) : undefined}
                                    style={!isTileView ? `--dependency-level:${getDependencyLevel(item)};` : undefined}
                                    in:receive={{ key: item.id }}
                                    out:send|local={{ key: item.id }}
                                    animate:flip={{ duration: flipDurationMs }}
                                >
                                    <ItemCard
                                        groupId={data.list.groupId}
                                        {isTileView}
                                        {item}
                                        onPublicList={isGuestView}
                                        {publicShareToken}
                                        allowAnonymousClaims={data.allowAnonymousClaims}
                                        requireClaimEmail={data.requireClaimEmail}
                                        showClaimForOwner={data.showClaimForOwner}
                                        showClaimedName={data.showClaimedName}
                                        showNameAcrossGroups={data.showNameAcrossGroups}
                                        user={data.loggedInUser}
                                        userCanManage={data.list.isManager}
                                    />
                                </div>
                            {/each}
                        {/each}
                    </div>
                {/if}
            </section>
        {/if}
    </div>

    <!-- spacer -->
    <footer class="print:hidden">
        <div class="h-16"></div>
    </footer>
{/if}

<!-- Add Item button -->
{#if data.loggedInUser && (data.list.owner.isMe || data.suggestionsEnabled)}
    <button
        class="preset-tonal btn btn-icon btn-icon-sm md:btn-icon-base inset-ring-surface-200-800 fixed right-4 z-30 h-16 w-16 p-0! inset-ring md:right-10 md:bottom-10 md:h-20 md:w-20 print:hidden"
        class:bottom-24={$isInstalled}
        class:bottom-4={!$isInstalled}
        aria-label="add item"
        onclick={() => goto(`${page.url.pathname}/create-item?redirectTo=${page.url.pathname}`, { replaceState: true })}
    >
        <iconify-icon class="text-xl md:text-2xl" icon="ion:add"></iconify-icon>
    </button>
{/if}

<svelte:head>
    <title>{listName}</title>
</svelte:head>

<style>
    .dependency-node {
        margin-left: calc(min(var(--dependency-level, 0), 5) * 1rem);
    }

    .dependency-node[data-dependency-level]:not([data-dependency-level="0"]) {
        border-left: 2px solid color-mix(in oklab, var(--color-primary-500) 20%, transparent);
        padding-left: 0.5rem;
    }
</style>
