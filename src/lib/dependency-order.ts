interface DependencyRef {
    id: number;
}

interface DependencyItem {
    id: number;
    dependsOn: DependencyRef[];
}

export const orderItemsByDependencies = <T extends DependencyItem>(sourceItems: T[]) => {
    const byId = new Map(sourceItems.map((item) => [item.id, item]));
    const rank = new Map(sourceItems.map((item, idx) => [item.id, idx]));
    const dependedOnByCount = new Map<number, number>();

    for (const item of sourceItems) {
        for (const dependency of item.dependsOn) {
            if (!byId.has(dependency.id)) {
                continue;
            }
            dependedOnByCount.set(dependency.id, (dependedOnByCount.get(dependency.id) || 0) + 1);
        }
    }

    const orderedItems: T[] = [];
    const levels = new Map<number, number>();
    const visited = new Set<number>();

    const inOrder = (a: T, b: T) => (rank.get(a.id) || 0) - (rank.get(b.id) || 0);

    const walk = (item: T, level: number) => {
        if (visited.has(item.id)) {
            return;
        }
        visited.add(item.id);
        orderedItems.push(item);
        levels.set(item.id, level);

        const dependencies = item.dependsOn
            .map(({ id }) => byId.get(id))
            .filter((dependency): dependency is T => dependency !== undefined)
            .toSorted(inOrder);

        for (const dependency of dependencies) {
            walk(dependency, level + 1);
        }
    };

    const roots = sourceItems.filter((item) => !dependedOnByCount.has(item.id)).toSorted(inOrder);
    for (const root of roots) {
        walk(root, 0);
    }

    for (const item of sourceItems.toSorted(inOrder)) {
        walk(item, 0);
    }

    return {
        items: orderedItems,
        levels
    };
};
