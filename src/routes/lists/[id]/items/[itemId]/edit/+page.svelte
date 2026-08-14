<script lang="ts">
    import { enhance } from "$app/forms";
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import ItemForm from "$lib/components/wishlists/ItemForm.svelte";
    import { getFormatter } from "$lib/i18n";
    import type { PageProps } from "./$types";

    const { data }: PageProps = $props();
    const t = getFormatter();
    let guestId = $state("");
    let saving = $state(false);
    onMount(() => {
        const shareId = data.shareToken?.split(".")[0];
        if (shareId) guestId = JSON.parse(localStorage.getItem(`lists:guest:${shareId}`) || "null")?.id || "";
    });
</script>

<form
    enctype="multipart/form-data"
    method="POST"
    use:enhance={() => {
        saving = true;
        return async () => {
            saving = false;
        };
    }}
>
    <input name="guestId" type="hidden" value={guestId} />
    <ItemForm guestMode buttonText={$t("general.save")} currentList={data.listId} item={data.item} {saving} />
</form>

<svelte:head><title>{$t("wishes.edit-wish")}</title></svelte:head>
