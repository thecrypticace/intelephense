import { Predicate } from './types';
import { SymbolIdentifier, SymbolKind } from './symbol';
import { Range, Location } from 'vscode-languageserver-types';
export interface Reference extends SymbolIdentifier {
    location: Location;
    type?: string;
    altName?: string;
}
export declare namespace Reference {
    function create(kind: SymbolKind, name: string, location: Location): Reference;
}
export interface Scope {
    range: Range;
    children: (Scope | Range)[];
}
export declare class ReferenceTable {
    private _uri;
    private _root;
    private _hash;
    constructor(uri: string, root: Scope);
    readonly uri: string;
    readonly root: Scope;
    readonly hash: number;
    readonly referenceCount: number;
    references(filter?: Predicate<Reference>): Reference[];
    referenceAtPosition(position: Position): void;
}
export declare class ReferenceStore {
    private _tables;
    private _refIndex;
    constructor();
    getReferenceTable(uri: string): ReferenceTable;
    add(table: ReferenceTable): void;
    remove(uri: string, purge?: boolean): void;
    close(uri: string): void;
    closeAll(): void;
    find(name: string, filter?: Predicate<Reference>): Promise<Reference[]>;
    private _indexableReferenceFilter(ref);
    private _referenceKeys(ref);
}
