<script lang="ts">
    import ClaimButtons from "../ClaimButtons.svelte";
    import type { InternalItemCardProps } from "../ItemCard.svelte";
    import ManageButtons from "../ManageButtons.svelte";
    import PriceTrendModal from "../../PriceTrendModal.svelte";
    import ReorderButtons from "../ReorderButtons.svelte";
    import { getFormatter } from "$lib/i18n";

    const props: Omit<InternalItemCardProps, "id" | "defaultImage"> = $props();
    const t = getFormatter();
</script>

<footer
    class={[
        "flex flex-wrap items-center gap-2 px-4 print:hidden",
        props.reorderActions ? "justify-center pb-0" : "justify-between pb-4"
    ]}
>
    {#if props.reorderActions}
        <ReorderButtons {...props} />
    {:else}
        <div class="flex flex-row flex-wrap gap-2">
            <ClaimButtons {...props} />
            <PriceTrendModal item={props.item} publicShareToken={props.publicShareToken}>
                {#snippet trigger(triggerProps)}
                    <button
                        {...triggerProps}
                        aria-label={$t("wishes.price-trend")}
                        class="btn btn-icon btn-icon-sm md:btn-icon-base preset-tonal-primary inset-ring-primary-500 inset-ring"
                        onclick={(event) => {
                            event.stopPropagation();
                            triggerProps.onclick?.(event);
                        }}
                        title={$t("wishes.price-trend")}
                        type="button"
                    >
                        <iconify-icon icon="ion:stats-chart"></iconify-icon>
                    </button>
                {/snippet}
            </PriceTrendModal>
        </div>
        <ManageButtons {...props} />
    {/if}
</footer>
