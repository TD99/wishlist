<script lang="ts" module>
    import type { DialogTriggerProps } from "@skeletonlabs/skeleton-svelte";
    import type { ItemOnListDTO } from "$lib/dtos/item-dto";

    export interface ListDistributionModalProps {
        items: ItemOnListDTO[];
        trigger: NonNullable<DialogTriggerProps["element"]>;
    }
</script>

<script lang="ts">
    import BaseModal from "$lib/components/modals/BaseModal.svelte";
    import { Dialog } from "@skeletonlabs/skeleton-svelte";
    import { getFormatter } from "$lib/i18n";
    import { formatNumberAsPrice } from "$lib/price-formatter";

    interface CurrencyTotal {
        currency: string;
        total: number;
    }

    interface ProductTotal {
        name: string;
        total: number;
        currency: string;
    }

    interface QuantityTotal {
        name: string;
        quantity: number;
    }

    interface PieSlice extends CurrencyTotal {
        color: string;
        ratio: number;
        start: number;
        end: number;
    }

    interface ProductPieSlice extends ProductTotal {
        color: string;
        ratio: number;
        start: number;
        end: number;
    }

    interface QuantityPieSlice extends QuantityTotal {
        color: string;
        ratio: number;
        start: number;
        end: number;
    }

    const PIE_COLORS = [
        "#2563EB",
        "#059669",
        "#F59E0B",
        "#DC2626",
        "#7C3AED",
        "#0EA5E9",
        "#F97316",
        "#14B8A6"
    ];

    const { items, trigger }: ListDistributionModalProps = $props();
    const t = getFormatter();
    let open = $state(false);
    let viewMode = $state<"currency" | "product" | "quantity">("product");
    let hoveredSlice = $state<PieSlice | null>(null);

    const getTotalsByCurrency = (source: ItemOnListDTO[]) => {
        const byCurrency = source
            .filter((item) => item.itemPrice !== null)
            .reduce(
                (accum, item) => {
                    const quantity = item.quantity || 1;
                    accum[item.itemPrice!.currency] =
                        (accum[item.itemPrice!.currency] || 0) + item.itemPrice!.value * quantity;
                    return accum;
                },
                {} as Record<string, number>
            );

        return Object.entries(byCurrency)
            .map(([currency, total]) => ({ currency, total }))
            .toSorted((a, b) => b.total - a.total);
    };

    const getTotalsByProduct = (source: ItemOnListDTO[]) => {
        return source
            .filter((item) => item.itemPrice !== null)
            .map((item) => {
                const quantity = item.quantity || 1;
                return {
                    name: item.itemName,
                    total: item.itemPrice!.value * quantity,
                    currency: item.itemPrice!.currency
                } satisfies ProductTotal;
            })
            .toSorted((a, b) => b.total - a.total);
    };

    const getQuantitiesByProduct = (source: ItemOnListDTO[]) => {
        return source
            .map((item) => ({
                name: item.itemName,
                quantity: item.quantity || 1
            } satisfies QuantityTotal))
            .toSorted((a, b) => b.quantity - a.quantity);
    };

    const makeSlices = (totals: CurrencyTotal[]) => {
        const total = totals.reduce((accum, slice) => accum + slice.total, 0);
        let cumulativeRatio = 0;

        return totals.map((entry, index) => {
            const ratio = total === 0 ? 0 : entry.total / total;
            const start = cumulativeRatio;
            const end = cumulativeRatio + ratio;
            cumulativeRatio = end;

            return {
                ...entry,
                ratio,
                start,
                end,
                color: PIE_COLORS[index % PIE_COLORS.length]
            } satisfies PieSlice;
        });
    };

    const makeProductSlices = (totals: ProductTotal[]) => {
        const total = totals.reduce((accum, slice) => accum + slice.total, 0);
        let cumulativeRatio = 0;

        return totals.map((entry, index) => {
            const ratio = total === 0 ? 0 : entry.total / total;
            const start = cumulativeRatio;
            const end = cumulativeRatio + ratio;
            cumulativeRatio = end;

            return {
                ...entry,
                ratio,
                start,
                end,
                color: PIE_COLORS[index % PIE_COLORS.length]
            } satisfies ProductPieSlice;
        });
    };

    const makeQuantitySlices = (totals: QuantityTotal[]) => {
        const total = totals.reduce((accum, slice) => accum + slice.quantity, 0);
        let cumulativeRatio = 0;

        return totals.map((entry, index) => {
            const ratio = total === 0 ? 0 : entry.quantity / total;
            const start = cumulativeRatio;
            const end = cumulativeRatio + ratio;
            cumulativeRatio = end;

            return {
                ...entry,
                ratio,
                start,
                end,
                color: PIE_COLORS[index % PIE_COLORS.length]
            } satisfies QuantityPieSlice;
        });
    };

    const toCartesian = (cx: number, cy: number, radius: number, ratio: number) => {
        const angle = ratio * Math.PI * 2 - Math.PI / 2;
        return {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle)
        };
    };

    const toSlicePath = (slice: { ratio: number; start: number; end: number }, cx: number, cy: number, radius: number) => {
        if (slice.ratio >= 0.9999) {
            return `M ${cx} ${cy} m -${radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 -${radius * 2} 0`;
        }

        const start = toCartesian(cx, cy, radius, slice.start);
        const end = toCartesian(cx, cy, radius, slice.end);
        const largeArc = slice.ratio > 0.5 ? 1 : 0;

        return [
            `M ${cx} ${cy}`,
            `L ${start.x} ${start.y}`,
            `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
            "Z"
        ].join(" ");
    };

    // Currency distribution (existing logic)
    const requiredTotals = $derived.by(() => getTotalsByCurrency(items.filter((item) => !item.optional)));
    const optionalTotals = $derived.by(() => getTotalsByCurrency(items.filter((item) => item.optional)));
    const allTotals = $derived.by(() => getTotalsByCurrency(items));

    const requiredSlices = $derived(makeSlices(requiredTotals));
    const optionalSlices = $derived(makeSlices(optionalTotals));
    const allSlices = $derived(makeSlices(allTotals));

    // Product distribution
    const requiredProducts = $derived.by(() => getTotalsByProduct(items.filter((item) => !item.optional)));
    const optionalProducts = $derived.by(() => getTotalsByProduct(items.filter((item) => item.optional)));
    const allProducts = $derived.by(() => getTotalsByProduct(items));

    const requiredProductSlices = $derived(makeProductSlices(requiredProducts));
    const optionalProductSlices = $derived(makeProductSlices(optionalProducts));
    const allProductSlices = $derived(makeProductSlices(allProducts));

    // Quantity distribution
    const requiredQuantities = $derived.by(() => getQuantitiesByProduct(items.filter((item) => !item.optional)));
    const optionalQuantities = $derived.by(() => getQuantitiesByProduct(items.filter((item) => item.optional)));
    const allQuantities = $derived.by(() => getQuantitiesByProduct(items));

    const requiredQuantitySlices = $derived(makeQuantitySlices(requiredQuantities));
    const optionalQuantitySlices = $derived(makeQuantitySlices(optionalQuantities));
    const allQuantitySlices = $derived(makeQuantitySlices(allQuantities));
</script>

{#snippet chartBlock(title: string, slices: PieSlice[] | ProductPieSlice[] | QuantityPieSlice[])}
    <section class="rounded-container border-surface-500 bg-surface-50-950 flex flex-col gap-3 border p-3">
        <h4 class="font-semibold">{title}</h4>
        {#if slices.length === 0}
            <p class="subtext">{$t("wishes.no-price-data")}</p>
        {:else}
            <div class="grid gap-3 lg:grid-cols-[10rem_1fr]">
                <div class="relative mx-auto size-40">
                    <svg aria-label={title} class="size-40" viewBox="0 0 120 120">
                        {#each slices as slice, index (viewMode === "currency" ? (slice as PieSlice).currency : viewMode === "product" ? (slice as ProductPieSlice).name + index : (slice as QuantityPieSlice).name + index)}
                            <path
                                d={toSlicePath(slice, 60, 60, 52)}
                                fill={slice.color}
                                style="cursor: pointer;"
                                onmouseenter={() => (hoveredSlice = slice)}
                                onmouseleave={() => (hoveredSlice = null)}
                                ontouchstart={() => (hoveredSlice = slice)}
                                ontouchend={() => (hoveredSlice = null)}
                            ></path>
                        {/each}
                    </svg>
                    {#if hoveredSlice}
                        <div class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface-900 px-3 py-2 text-center text-xs shadow-lg border border-surface-500">
                            {#if viewMode === "currency"}
                                {@const currSlice = hoveredSlice as PieSlice}
                                <div class="font-semibold">{currSlice.currency}</div>
                                <div>{formatNumberAsPrice(currSlice.currency, currSlice.total)}</div>
                                <div class="opacity-70">{(currSlice.ratio * 100).toFixed(1)}%</div>
                            {:else if viewMode === "product"}
                                {@const prodSlice = hoveredSlice as ProductPieSlice}
                                <div class="font-semibold max-w-[150px] truncate">{prodSlice.name}</div>
                                <div>{formatNumberAsPrice(prodSlice.currency, prodSlice.total)}</div>
                                <div class="opacity-70">{(prodSlice.ratio * 100).toFixed(1)}%</div>
                            {:else if viewMode === "quantity"}
                                {@const qtySlice = hoveredSlice as QuantityPieSlice}
                                <div class="font-semibold max-w-[150px] truncate">{qtySlice.name}</div>
                                <div>{qtySlice.quantity} {$t("wishes.items")}</div>
                                <div class="opacity-70">{(qtySlice.ratio * 100).toFixed(1)}%</div>
                            {/if}
                        </div>
                    {/if}
                </div>
                <ul class="grid gap-1">
                    {#each slices as slice, index (viewMode === "currency" ? (slice as PieSlice).currency : viewMode === "product" ? (slice as ProductPieSlice).name + index : (slice as QuantityPieSlice).name + index)}
                        <li class="flex items-center justify-between gap-2">
                            <span class="flex items-center gap-2 min-w-0">
                                <span class="size-3 rounded-full flex-shrink-0" style={`background:${slice.color};`}></span>
                                {#if viewMode === "currency"}
                                    <span>{(slice as PieSlice).currency}</span>
                                {:else if viewMode === "product"}
                                    <span class="truncate">{(slice as ProductPieSlice).name}</span>
                                {:else if viewMode === "quantity"}
                                    <span class="truncate">{(slice as QuantityPieSlice).name}</span>
                                {/if}
                            </span>
                            <span class="text-right flex-shrink-0">
                                {#if viewMode === "currency"}
                                    {@const currSlice = slice as PieSlice}
                                    {formatNumberAsPrice(currSlice.currency, currSlice.total)} ({(currSlice.ratio * 100).toFixed(1)}%)
                                {:else if viewMode === "product"}
                                    {@const prodSlice = slice as ProductPieSlice}
                                    {formatNumberAsPrice(prodSlice.currency, prodSlice.total)} ({(prodSlice.ratio * 100).toFixed(1)}%)
                                {:else if viewMode === "quantity"}
                                    {@const qtySlice = slice as QuantityPieSlice}
                                    {qtySlice.quantity} ({(qtySlice.ratio * 100).toFixed(1)}%)
                                {/if}
                            </span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
    </section>
{/snippet}

<BaseModal
    {open}
    {trigger}
    description={$t("wishes.list-distribution-description")}
    onOpenChange={(event) => (open = event.open)}
    title={$t("wishes.list-distribution")}
>
    {#snippet children()}
        <div class="mb-4 flex items-center gap-2">
            <label for="view-mode" class="font-semibold">{$t("wishes.view-mode-label")}:</label>
            <select
                id="view-mode"
                bind:value={viewMode}
                class="rounded-lg border border-surface-500 bg-surface-50-950 px-3 py-2"
            >
                <option value="product">{$t("wishes.view-mode-product")}</option>
                <option value="currency">{$t("wishes.view-mode-currency")}</option>
                <option value="quantity">{$t("wishes.view-mode-quantity")}</option>
            </select>
        </div>
        <div class="grid gap-3">
            {#if viewMode === "currency"}
                {@render chartBlock($t("wishes.required"), requiredSlices)}
                {@render chartBlock($t("wishes.optional"), optionalSlices)}
                {@render chartBlock($t("wishes.both"), allSlices)}
            {:else if viewMode === "product"}
                {@render chartBlock($t("wishes.required"), requiredProductSlices)}
                {@render chartBlock($t("wishes.optional"), optionalProductSlices)}
                {@render chartBlock($t("wishes.both"), allProductSlices)}
            {:else if viewMode === "quantity"}
                {@render chartBlock($t("wishes.required"), requiredQuantitySlices)}
                {@render chartBlock($t("wishes.optional"), optionalQuantitySlices)}
                {@render chartBlock($t("wishes.both"), allQuantitySlices)}
            {/if}
        </div>
    {/snippet}

    {#snippet actions({ neutralStyle })}
        <Dialog.CloseTrigger class={neutralStyle} type="button">
            {$t("general.cancel")}
        </Dialog.CloseTrigger>
    {/snippet}
</BaseModal>
