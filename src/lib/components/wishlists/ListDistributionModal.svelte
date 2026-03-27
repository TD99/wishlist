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

    interface PieSlice extends CurrencyTotal {
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

    const toCartesian = (cx: number, cy: number, radius: number, ratio: number) => {
        const angle = ratio * Math.PI * 2 - Math.PI / 2;
        return {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle)
        };
    };

    const toSlicePath = (slice: PieSlice, cx: number, cy: number, radius: number) => {
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

    const requiredTotals = $derived.by(() => getTotalsByCurrency(items.filter((item) => !item.optional)));
    const optionalTotals = $derived.by(() => getTotalsByCurrency(items.filter((item) => item.optional)));
    const allTotals = $derived.by(() => getTotalsByCurrency(items));

    const requiredSlices = $derived(makeSlices(requiredTotals));
    const optionalSlices = $derived(makeSlices(optionalTotals));
    const allSlices = $derived(makeSlices(allTotals));
</script>

{#snippet chartBlock(title: string, slices: PieSlice[])}
    <section class="rounded-container border-surface-500 bg-surface-50-950 flex flex-col gap-3 border p-3">
        <h4 class="font-semibold">{title}</h4>
        {#if slices.length === 0}
            <p class="subtext">{$t("wishes.no-price-data")}</p>
        {:else}
            <div class="grid gap-3 lg:grid-cols-[10rem_1fr]">
                <svg aria-label={title} class="mx-auto size-40" viewBox="0 0 120 120">
                    {#each slices as slice (slice.currency)}
                        <path d={toSlicePath(slice, 60, 60, 52)} fill={slice.color}></path>
                    {/each}
                </svg>
                <ul class="grid gap-1">
                    {#each slices as slice (slice.currency)}
                        <li class="flex items-center justify-between gap-2">
                            <span class="flex items-center gap-2">
                                <span class="size-3 rounded-full" style={`background:${slice.color};`}></span>
                                <span>{slice.currency}</span>
                            </span>
                            <span class="text-right">
                                {formatNumberAsPrice(slice.currency, slice.total)} ({(slice.ratio * 100).toFixed(1)}%)
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
        <div class="grid gap-3">
            {@render chartBlock($t("wishes.required"), requiredSlices)}
            {@render chartBlock($t("wishes.optional"), optionalSlices)}
            {@render chartBlock($t("wishes.both"), allSlices)}
        </div>
    {/snippet}

    {#snippet actions({ neutralStyle })}
        <Dialog.CloseTrigger class={neutralStyle} type="button">
            {$t("general.cancel")}
        </Dialog.CloseTrigger>
    {/snippet}
</BaseModal>
