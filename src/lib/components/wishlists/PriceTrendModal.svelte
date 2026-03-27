<script lang="ts" module>
    import type { DialogTriggerProps } from "@skeletonlabs/skeleton-svelte";
    import type { ItemOnListDTO } from "$lib/dtos/item-dto";

    interface PricePoint {
        value: number;
        currency: string;
        polledAt: string;
    }

    interface PriceHistoryResponse {
        pricePollingEnabled: boolean;
        lastPricePolledAt: string | null;
        nextPricePollAt: string | null;
        currentPrice: {
            value: number;
            currency: string;
        } | null;
        points: PricePoint[];
    }

    export interface PriceTrendModalProps {
        item: ItemOnListDTO;
        publicShareToken?: string;
        trigger: NonNullable<DialogTriggerProps["element"]>;
    }
</script>

<script lang="ts">
    import BaseModal from "$lib/components/modals/BaseModal.svelte";
    import { ListItemAPI } from "$lib/api/lists";
    import { getFormatter } from "$lib/i18n";
    import { formatNumberAsPrice } from "$lib/price-formatter";
    import { Dialog } from "@skeletonlabs/skeleton-svelte";

    const CHART_WIDTH = 720;
    const CHART_HEIGHT = 240;
    const CHART_PADDING = 26;

    const { item, publicShareToken, trigger }: PriceTrendModalProps = $props();
    const t = getFormatter();

    let open = $state(false);
    let loading = $state(false);
    let history = $state<PriceHistoryResponse | null>(null);
    let errorMessage = $state<string | null>(null);

    const listItemAPI = $derived(new ListItemAPI(item.listId, item.id, { shareToken: publicShareToken }));

    const primaryCurrency = $derived.by(() => {
        if (history?.currentPrice?.currency) {
            return history.currentPrice.currency;
        }

        return history?.points.at(-1)?.currency || null;
    });

    const points = $derived.by(() => {
        const currency = primaryCurrency;
        if (!history || !currency) {
            return [] as PricePoint[];
        }

        return history.points.filter((point) => point.currency === currency);
    });

    const valueRange = $derived.by(() => {
        if (points.length === 0) {
            return { min: 0, max: 0 };
        }

        const values = points.map(({ value }) => value);
        return {
            min: Math.min(...values),
            max: Math.max(...values)
        };
    });

    const coordinates = $derived.by(() => {
        if (points.length === 0) {
            return [] as { x: number; y: number; point: PricePoint }[];
        }

        const span = Math.max(valueRange.max - valueRange.min, 1);
        const contentWidth = CHART_WIDTH - CHART_PADDING * 2;
        const contentHeight = CHART_HEIGHT - CHART_PADDING * 2;

        return points.map((point, index) => {
            const x = CHART_PADDING + (points.length === 1 ? contentWidth / 2 : (index / (points.length - 1)) * contentWidth);
            const y = CHART_PADDING + contentHeight - ((point.value - valueRange.min) / span) * contentHeight;

            return { x, y, point };
        });
    });

    const pathD = $derived.by(() => {
        if (coordinates.length === 0) {
            return "";
        }

        return coordinates
            .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
            .join(" ");
    });

    const trendSummary = $derived.by(() => {
        if (points.length < 2 || !primaryCurrency) {
            return null;
        }

        const first = points[0].value;
        const last = points[points.length - 1].value;
        const diff = last - first;
        const percent = first === 0 ? null : (diff / first) * 100;

        return {
            first,
            last,
            diff,
            percent
        };
    });

    const formatTimestamp = (value: string | null) => {
        return value ? new Date(value).toLocaleString() : $t("general.na");
    };

    const refreshHistory = async () => {
        loading = true;
        errorMessage = null;

        const response = await listItemAPI.getPriceHistory();
        if (!response.ok) {
            errorMessage = await response.text();
            loading = false;
            return;
        }

        history = (await response.json()) as PriceHistoryResponse;
        loading = false;
    };
</script>

<BaseModal
    {open}
    {trigger}
    description={$t("wishes.price-trend-description")}
    onOpenChange={(event) => {
        open = event.open;
        if (event.open) {
            void refreshHistory();
        }
    }}
    title={$t("wishes.price-trend")}
>
    {#snippet children()}
        {#if loading}
            <div class="flex items-center gap-2">
                <span class="loading loading-spinner loading-sm"></span>
                <span>{$t("general.loading")}</span>
            </div>
        {:else if errorMessage}
            <p class="text-error-500">{errorMessage}</p>
        {:else if !history || points.length === 0 || !primaryCurrency}
            <p class="subtext">{$t("wishes.no-price-history")}</p>
        {:else}
            <div class="rounded-container border-surface-500 bg-surface-50-950 border p-2">
                <svg aria-label={$t("wishes.price-trend")} class="h-48 w-full" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
                    <path d={pathD} fill="none" stroke="var(--color-primary-500)" stroke-width="2.5"></path>
                    {#each coordinates as { x, y, point } (point.polledAt)}
                        <circle cx={x} cy={y} fill="var(--color-primary-500)" r="3"></circle>
                    {/each}
                </svg>
            </div>

            <div class="grid gap-1 text-sm">
                <span class="subtext">
                    {$t("wishes.last-price-polled")}: {formatTimestamp(history.lastPricePolledAt)}
                </span>
                <span class="subtext">
                    {$t("wishes.next-price-poll")}: {formatTimestamp(history.nextPricePollAt)}
                </span>
                {#if trendSummary}
                    <span>
                        {$t("wishes.price-change")}:
                        {formatNumberAsPrice(primaryCurrency, trendSummary.first)}
                        →
                        {formatNumberAsPrice(primaryCurrency, trendSummary.last)}
                        ({trendSummary.diff >= 0 ? "+" : ""}{formatNumberAsPrice(primaryCurrency, trendSummary.diff)})
                        {#if trendSummary.percent !== null}
                            · {trendSummary.percent >= 0 ? "+" : ""}{trendSummary.percent.toFixed(1)}%
                        {/if}
                    </span>
                {/if}
            </div>
        {/if}
    {/snippet}

    {#snippet actions({ neutralStyle })}
        <Dialog.CloseTrigger class={neutralStyle} type="button">
            {$t("general.cancel")}
        </Dialog.CloseTrigger>
    {/snippet}
</BaseModal>
