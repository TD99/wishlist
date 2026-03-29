<script lang="ts">
    import errorAsset from "$lib/assets/error.svg";
    import { getFormatter } from "$lib/i18n";

    const t = getFormatter();
</script>

<div class="flex flex-col items-center justify-center space-y-4 pt-4">
    <p class="text-4xl">🔌</p>
    <img class="w-3/4 md:w-1/3" alt={$t("errors.offline-title")} src={errorAsset} />
    <p class="text-2xl">{$t("errors.offline-title")}</p>
    <p class="text-center text-base opacity-70 max-w-md px-4">{$t("errors.offline-message")}</p>
    <a class="preset-filled-primary-500 btn" href="/">{$t("general.return-home")}</a>
</div>
