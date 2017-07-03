export interface Predicate<T> {
    (t: T): boolean;
}
export interface DebugLogger {
    debug(message: string): void;
}
export interface EventHandler<T> {
    (t: T): void;
}
export interface Unsubscribe {
    (): void;
}
export declare class Event<T> {
    private _subscribed;
    constructor();
    subscribe(handler: EventHandler<T>): Unsubscribe;
    trigger(args: T): void;
}
export interface TreeLike {
    [index: string]: any;
    children?: TreeLike[];
}
export declare class TreeTraverser<T extends TreeLike> {
    private _spine;
    constructor(spine: T[]);
    readonly spine: T[];
    readonly node: T;
    traverse(visitor: TreeVisitor<T>): void;
    filter(predicate: Predicate<T>): T[];
    toArray(): T[];
    count(): number;
    depth(): number;
    up(n: number): void;
    find(predicate: Predicate<T>): T;
    prevSibling(): T;
    nextSibling(): T;
    ancestor(predicate: Predicate<T>): T;
    parent(): T;
    clone(): TreeTraverser<T>;
    private _traverse(treeNode, visitor, spine);
}
export interface Traversable<T extends TreeLike> {
    traverse(visitor: TreeVisitor<T>): TreeVisitor<T>;
}
export interface TreeVisitor<T extends TreeLike> {
    /**
     * True will halt traverse immediately.
     * No further functions will be called.
     */
    haltTraverse?: boolean;
    /**
     * Return value determines whether to descend into child nodes
     */
    preorder?(node: T, spine: T[]): boolean;
    postorder?(node: T, spine: T[]): void;
}
export declare class Debounce<T> {
    wait: number;
    private _handler;
    private _lastEvent;
    private _timer;
    constructor(handler: (e: T) => void, wait: number);
    clear: () => void;
    handle(event: T): void;
    flush(): void;
}
export declare class ToArrayVisitor<T> implements TreeVisitor<T> {
    private _array;
    constructor();
    readonly array: T[];
    preorder(t: T, spine: T[]): boolean;
}
export declare class CountVisitor<T> implements TreeVisitor<T> {
    private _count;
    constructor();
    readonly count: number;
    preorder(t: T, spine: T[]): boolean;
}
export declare class MultiVisitor<T> implements TreeVisitor<T> {
    protected _visitors: [TreeVisitor<T>, TreeLike][];
    haltTraverse: boolean;
    constructor(visitors: TreeVisitor<T>[]);
    add(v: TreeVisitor<T>): void;
    preorder(node: T, spine: T[]): boolean;
    postorder(node: T, spine: T[]): void;
}
export declare class BinarySearch<T> {
    private _sortedArray;
    constructor(sortedArray: T[]);
    find(compare: (n: T) => number): T;
    rank(compare: (n: T) => number): number;
    range(compareLower: (n: T) => number, compareUpper: (T) => number): T[];
    search(compare: (n: T) => number, offset?: number): BinarySearchResult;
}
export interface BinarySearchResult {
    rank: number;
    isExactMatch: boolean;
}
