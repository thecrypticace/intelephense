import { TypeString } from './typeString';
import { Location } from 'vscode-languageserver-types';
export declare const enum SymbolKind {
    None = 0,
    Class = 1,
    Interface = 2,
    Trait = 4,
    Constant = 8,
    Property = 16,
    Method = 32,
    Function = 64,
    Parameter = 128,
    Variable = 256,
    Namespace = 512,
    ClassConstant = 1024,
}
export declare const enum SymbolModifier {
    None = 0,
    Public = 1,
    Protected = 2,
    Private = 4,
    Final = 8,
    Abstract = 16,
    Static = 32,
    ReadOnly = 64,
    WriteOnly = 128,
    Magic = 256,
    Anonymous = 512,
    Reference = 1024,
    Variadic = 2048,
    Use = 4096,
}
export interface PhpSymbol {
    kind: SymbolKind;
    name: string;
    location?: Location;
    modifiers?: SymbolModifier;
    description?: string;
    type?: TypeString;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    scope?: string;
    value?: string;
    typeSource?: TypeSource;
}
export declare namespace PhpSymbol {
    function signatureString(s: PhpSymbol): string;
    function hasParameters(s: PhpSymbol): boolean;
    function notFqn(text: string): string;
    /**
     * Shallow clone
     * @param s
     */
    function clone(s: PhpSymbol): PhpSymbol;
}
export declare const enum TypeSource {
    None = 0,
    TypeDeclaration = 1,
}
export declare class SymbolIndex {
    private _nodeArray;
    private _binarySearch;
    private _collator;
    constructor();
    add(item: PhpSymbol): void;
    addMany(items: PhpSymbol[]): void;
    remove(item: PhpSymbol): void;
    removeMany(items: PhpSymbol[]): void;
    match(text: string, fuzzy?: boolean): PhpSymbol[];
    private _sortedFuzzyResults(query, matches);
    private _nodeMatch(lcText);
    private _nodeFind(text);
    private _insertNode(node);
    private _deleteNode(node);
    private _symbolKeys(s);
    private _hasLength(text);
    private _namespaceSymbolKeys(s);
}
export interface PhpSymbolDto {
    kind: SymbolKind;
    name: string;
    location?: number[];
    modifiers?: SymbolModifier;
    description?: string;
    type?: string;
    associated?: PhpSymbolDto[];
    children?: PhpSymbolDto[];
    scope?: string;
    value?: string;
    typeSource?: TypeSource;
}
