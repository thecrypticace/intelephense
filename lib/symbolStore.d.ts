import { PhpSymbol, Reference, SymbolIdentifier } from './symbol';
import { Predicate, TreeVisitor, Traversable } from './types';
import { Position, Location } from 'vscode-languageserver-types';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { MemberMergeStrategy } from './typeAggregate';
export declare class SymbolTable implements Traversable<PhpSymbol> {
    private _uri;
    private _root;
    private _hash;
    constructor(uri: string, root: PhpSymbol);
    readonly uri: string;
    readonly root: PhpSymbol;
    readonly hash: number;
    readonly symbols: PhpSymbol[];
    readonly symbolCount: number;
    readonly referenceCount: number;
    parent(s: PhpSymbol): PhpSymbol;
    traverse(visitor: TreeVisitor<PhpSymbol>): TreeVisitor<PhpSymbol>;
    filter(predicate: Predicate<PhpSymbol>): PhpSymbol[];
    find(predicate: Predicate<PhpSymbol>): PhpSymbol;
    nameResolver(pos: Position): NameResolver;
    scope(pos: Position): PhpSymbol;
    absoluteScope(pos: Position): PhpSymbol;
    scopeSymbols(): PhpSymbol[];
    symbolAtPosition(position: Position): PhpSymbol;
    references(filter?: Predicate<Reference>): Reference[];
    referenceAtPosition(position: Position): Reference;
    contains(identifier: SymbolIdentifier): boolean;
    private _isScopeSymbol(s);
    private _hasReferences(s);
    static create(parsedDocument: ParsedDocument, externalOnly?: boolean): SymbolTable;
    static readBuiltInSymbols(): SymbolTable;
}
export declare class SymbolStore {
    private _tableIndex;
    private _symbolIndex;
    private _referenceIndex;
    private _symbolCount;
    constructor();
    onParsedDocumentChange: (args: ParsedDocumentChangeEventArgs) => void;
    getSymbolTable(uri: string): SymbolTable;
    readonly tableCount: number;
    readonly symbolCount: number;
    add(symbolTable: SymbolTable): void;
    remove(uri: string): void;
    indexReferences(symbolTable: SymbolTable): void;
    /**
     * Finds all indexed symbols that match text exactly.
     * Case sensitive for constants and variables and insensitive for
     * classes, traits, interfaces, functions, methods
     * @param text
     * @param filter
     */
    find(text: string, filter?: Predicate<PhpSymbol>): PhpSymbol[];
    /**
     * Fuzzy matches indexed symbols.
     * Case insensitive
     */
    match(text: string, filter?: Predicate<PhpSymbol>): PhpSymbol[];
    findSymbolsByReference(ref: Reference, memberMergeStrategy?: MemberMergeStrategy): PhpSymbol[];
    findMembers(scope: string, memberMergeStrategy: MemberMergeStrategy, predicate?: Predicate<PhpSymbol>): PhpSymbol[];
    findBaseMember(symbol: PhpSymbol): PhpSymbol;
    findOverrides(baseSymbol: PhpSymbol): PhpSymbol[];
    findReferences(name: string, filter?: Predicate<Reference>): Reference[];
    identifierLocation(identifier: SymbolIdentifier): Location;
    referenceToTypeString(ref: Reference): string;
    private _sortMatches(query, matches);
    private _classOrInterfaceFilter(s);
    private _classInterfaceTraitFilter(s);
    private _indexSymbols(root);
    private _indexableReferenceFilter(ref);
    /**
     * No vars, params or symbols with use modifier or private modifier
     * @param s
     */
    private _indexFilter(s);
    private _symbolKeys(s);
    private _referenceKeys(ref);
}
