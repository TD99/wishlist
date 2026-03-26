<script lang="ts">
    import { getFormatter } from "$lib/i18n";
    import BaseChip from "./BaseChip.svelte";

    const t = getFormatter();
    const options: Option[] = [
        {
            value: "all",
            displayValue: $t("general.all")
        },
        {
            value: "required",
            displayValue: $t("wishes.required")
        },
        {
            value: "optional",
            displayValue: $t("wishes.optional")
        }
    ];

    const label = $t("wishes.item-type");
    const defaultOption = options[0];
    const searchParam = "requirement";
    const prefix = "ion:filter";
</script>

<BaseChip {defaultOption} {label} {options} {prefix} {searchParam} />
