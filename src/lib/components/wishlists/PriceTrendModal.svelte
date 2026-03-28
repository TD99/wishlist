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
    const AXIS_LABEL_OFFSET = 20;

    const { item, publicShareToken, trigger }: PriceTrendModalProps = $props();
    const t = getFormatter();

    let open = $state(false);
    let loading = $state(false);
    let history = $state<PriceHistoryResponse | null>(null);
    let errorMessage = $state<string | null>(null);
    let hoveredPoint = $state<{ x: number; y: number; point: PricePoint } | null>(null);

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

    const getPointKey = (point: PricePoint, index: number) => {
        return `${point.polledAt}:${index}`;
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
                    <!-- Y-axis label (Price) -->
                    <text
                        x={CHART_PADDING - AXIS_LABEL_OFFSET}
                        y={CHART_HEIGHT / 2}
                        text-anchor="middle"
                        transform={`rotate(-90 ${CHART_PADDING - AXIS_LABEL_OFFSET} ${CHART_HEIGHT / 2})`}
                        class="fill-current text-xs"
                    >
                        {$t("wishes.price-axis-label")} ({primaryCurrency})
                    </text>
                    
                    <!-- X-axis label (Time) -->
                    <text
                        x={CHART_WIDTH / 2}
                        y={CHART_HEIGHT - 5}
                        text-anchor="middle"
                        class="fill-current text-xs"
                    >
                        {$t("wishes.time-axis-label")}
                    </text>
                    
                    <!-- Chart line -->
                    <path d={pathD} fill="none" stroke="var(--color-primary-500)" stroke-width="2.5"></path>
                    
                    <!-- Data points with hover area -->
                    {#each coordinates as { x, y, point }, index (getPointKey(point, index))}
                        <g>
                            <circle cx={x} cy={y} fill="var(--color-primary-500)" r="3"></circle>
                            <!-- Invisible larger circle for easier hover -->
                            <circle
                                cx={x}
                                cy={y}
                                r="10"
                                fill="transparent"
                                style="cursor: pointer;"
                                onmouseenter={() => (hoveredPoint = { x, y, point })}
                                onmouseleave={() => (hoveredPoint = null)}
                                ontouchstart={() => (hoveredPoint = { x, y, point })}
                                ontouchend={() => (hoveredPoint = null)}
                            ></circle>
                        </g>
                    {/each}
                    
                    <!-- Tooltip -->
                    {#if hoveredPoint}
                        {@const tooltipX = hoveredPoint.x > CHART_WIDTH / 2 ? hoveredPoint.x - 10 : hoveredPoint.x + 10}
                        {@const tooltipAnchor = hoveredPoint.x > CHART_WIDTH / 2 ? "end" : "start"}
                        <g>
                            <rect
                                x={tooltipX - (tooltipAnchor === "end" ? 150 : 0)}
                                y={hoveredPoint.y - 30}
                                width="150"
                                height="26"
                                fill="var(--color-surface-900)"
                                stroke="var(--color-surface-500)"
                                stroke-width="1"
                                rx="4"
                            ></rect>
                            <text
                                x={tooltipX - (tooltipAnchor === "end" ? 145 : -5)}
                                y={hoveredPoint.y - 18}
                                class="fill-current text-xs font-semibold"
                            >
                                {formatNumberAsPrice(hoveredPoint.point.currency, hoveredPoint.point.value)}
                            </text>
                            <text
                                x={tooltipX - (tooltipAnchor === "end" ? 145 : -5)}
                                y={hoveredPoint.y - 6}
                                class="fill-current text-[10px] opacity-70"
                            >
                                {new Date(hoveredPoint.point.polledAt).toLocaleDateString()}
                            </text>
                        </g>
                    {/if}
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
