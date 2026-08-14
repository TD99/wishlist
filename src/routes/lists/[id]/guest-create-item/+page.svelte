<script lang="ts">
    import { enhance } from "$app/forms";
    import { onMount } from "svelte";
    import ItemForm from "$lib/components/wishlists/ItemForm.svelte";
    import { getFormatter } from "$lib/i18n";
    import type { Item } from "$lib/generated/prisma/client";
    import type { PageProps } from "./$types";

    const { data }: PageProps = $props();
    const t = getFormatter();
    let guestId = $state("");
    let saving = $state(false);
    const item: Pick<Item, "name" | "price" | "url" | "note" | "imageUrl" | "pricePollingEnabled"> = {
        name: "",
        price: null,
        url: null,
        note: null,
        imageUrl: null,
        pricePollingEnabled: false
    };

    onMount(() => {
        const shareId = data.shareToken?.split(".")[0];
        if (shareId) guestId = JSON.parse(sessionStorage.getItem(`lists:guest:${shareId}`) || "null")?.id || "";
    });
</script>

<form
    enctype="multipart/form-data"
    method="POST"
    use:enhance={() => {
        saving = true;
        return async ({ update }) => {
            saving = false;
            await update();
        };
    }}
>
    <input name="guestId" type="hidden" value={guestId} />
    <ItemForm guestMode buttonText={$t("wishes.add-item")} currentList={data.listId} {item} {saving} />
</form>

<svelte:head><title>{$t("wishes.create")}</title></svelte:head>
