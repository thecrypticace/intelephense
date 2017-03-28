export interface Predicate<T> {
    (t: T): boolean;
}
export interface DebugLogger {
    debug(message: string): void;
}
export interface EventHandler<T> {
    (t: T): void;
}
export declare class Event<T> {
    private _subscribed;
    constructor();
    subscribe(handler: EventHandler<T>): () => void;
    trigger(args: T): void;
}
export interface TreeLike {
    children?: TreeLike[];
}
export declare class TreeTraverser<T extends TreeLike> {
    spine: T[];
    constructor(spine: T[]);
    readonly node: T;
    traverse(visitor: TreeVisitor<T>): void;
    filter(predicate: Predicate<T>): T[];
    find(predicate: Predicate<T>): T;
    prevSibling(): T;
    nextSibling(): T;
    ancestor(predicate: Predicate<T>): T;
    private _traverse(treeNode, visitor, spine);
}
export interface TreeVisitor<T extends TreeLike> {
    haltTraverse?: boolean;
    preOrder?(node: T, spine: T[]): boolean;
    postOrder?(node: T, spine: T[]): void;
}
export declare class Debounce<T> {
    private _handler;
    private _lastEvent;
    private _timer;
    private _wait;
    constructor(handler: (e: T) => void, wait: number);
    clear: () => void;
    handle(event: T): void;
    flush(): void;
}
export declare class ToArrayVisitor<T> implements TreeVisitor<T> {
    private _array;
    constructor();
    readonly array: T[];
    preOrder(t: T, spine: T[]): boolean;
}
export declare class CountVisitor<T> implements TreeVisitor<T> {
    private _count;
    constructor();
    readonly count: number;
    preOrder(t: T, spine: T[]): boolean;
}
export declare class BinarySearch<T> {
    private _sortedArray;
    constructor(sortedArray: T[]);
    find(compare: (n: T) => number): T;
    rank(compare: (n: T) => number): number;
    range(compareLower: (n: T) => number, compareUpper: (T) => number): T[];
    private _search(compare, left?);
}
