/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';

export enum SymbolKind {
    None = 0,
    Class = 1 << 0,
    Interface = 1 << 1,
    Trait = 1 << 2,
    Constant = 1 << 3,
    Property = 1 << 4,
    Method = 1 << 5,
    Function = 1 << 6,
    Parameter = 1 << 7,
    Variable = 1 << 8,
    Namespace = 1 << 9
}

export enum SymbolModifier {
    None = 0,
    Public = 1 << 0,
    Protected = 1 << 1,
    Private = 1 << 2,
    Final = 1 << 3,
    Abstract = 1 << 4,
    Static = 1 << 5,
    ReadOnly = 1 << 6,
    WriteOnly = 1 << 7,
    Magic = 1 << 8,
    Use = 1 << 9,
    Anonymous = 1 << 10
}

export class Symbol {
    kind: SymbolKind;
    name: string;
    uri: string;
    range: Range;
    scope: string;
    modifiers: SymbolModifier;
    aliasOf: string;
    description: string;

    constructor(symbolKind: SymbolKind, symbolName: string) {
        this.kind = symbolKind;
        this.name = symbolName;
    }

    get uid() {
        return [
            this.uri ? this.uri : '?',
            this.scope ? this.scope : '?',
            SymbolKind[this.kind],
            this.name
        ].join('|');
    }

    isEqualTo(symbol: Symbol) {
        return this.kind === symbol.kind &&
            this.name === symbol.name &&
            this.uri === symbol.uri &&
            this.scope === symbol.scope;
    }

    toString() {
        return this.name;
    }
}

export class TypeSymbol extends Symbol {
    extends: string[];
    implements: string[];
    traits: string[];

    constructor(symbolKind: SymbolKind, symbolName: string) {
        super(symbolKind, symbolName);
    }
}

export class CallableSymbol extends Symbol {
    returnTypes: string[];
    signature: string;

    constructor(symbolKind: SymbolKind, symbolName: string) {
        super(symbolKind, symbolName);
    }
}

export class VariableSymbol extends Symbol {
    types: string[];

    constructor(symbolKind: SymbolKind, symbolName: string) {
        super(symbolKind, symbolName);
    }
}

export class SymbolTree extends Tree<Symbol> {

    private _uri: string;

    constructor(uri: string) {
        super(null);
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }

    first(predicate: Predicate<Symbol>) {
        let symbol: Symbol;
        let visitor: TreeVisitor<Symbol> = (s, d) => {
            if (s && predicate(s)) {
                symbol = s;
                return false;
            }
            return true;
        };
        this.breadthFirstTraverse(visitor);
        return symbol;
    }

    match(predicate: Predicate<Symbol>, maxDepth = Infinity) {
        let symbols: Symbol[] = [];
        let visitor: TreeVisitor<Symbol> = (s, d) => {
            if (d > maxDepth) {
                return false;
            }
            if (s && predicate(s)) {
                symbols.push(s);
            }
            return true;
        };

        this.breadthFirstTraverse(visitor);
        return symbols;
    }

    toArray() {
        let symbols = super.toArray();
        symbols.shift(); //root has null value
        return symbols;
    }

}

/**
 * Get suffixes after $, namespace separator, underscore and on capitals
 * Includes acronym using non namespaced portion of string
 */
function symbolSuffixes(symbol: Symbol) {
    let text = symbol.toString();
    let lcText = text.toLowerCase();
    let suffixes = [lcText];
    let n = 0;
    let c: string;
    let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';

    while (n < text.length) {

        c = text[n];

        if (c === '\\') {
            acronym = '';
        }

        if ((c === '$' || c === '\\' || c === '_') && n + 1 < text.length && text[n + 1] !== '_') {
            ++n;
            suffixes.push(lcText.slice(n));
            acronym += lcText[n];
        } else if (c !== lcText[n]) {
            //uppercase
            suffixes.push(lcText.slice(n));
            acronym += lcText[n];
        }

        ++n;

    }

    if (acronym.length > 1) {
        suffixes.push(acronym);
    }

    return suffixes;
}

export class SymbolStore {

    private _map: { [uri: string]: SymbolTree };
    private _index: SuffixArray<Symbol>;

    constructor() {
        this._map = {};
        this._index = new SuffixArray<Symbol>(symbolSuffixes);
    }

    getTree(uri: string) {
        return this._map[uri];
    }

    add(symbolTree: SymbolTree) {
        if (this.getTree(symbolTree.uri)) {
            throw new Error(`Duplicate key ${symbolTree.uri}`);
        }
        this._map[symbolTree.uri] = symbolTree;
        this._index.addMany(this._externalSymbols(symbolTree));
    }

    remove(symbolTree: SymbolTree) {
        let tree = this.getTree(symbolTree.uri);
        if (!tree) {
            return;
        }
        this._index.removeMany(this._externalSymbols(tree));
        delete this._map[tree.uri];
    }

    /**
     * Matches external symbols only
     */
    match(text: string) {
        let symbols = this._index.match(text);
        let map: { [index: string]: Symbol } = {};
        let uid:string;
        let uniqueSymbols:Symbol[] = [];
        let s:Symbol;

        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            uid = s.uid;
            if(!map[uid]){
                map[uid] = s;
                uniqueSymbols.push(s);
            }
        }

        return uniqueSymbols;
    }

    private _externalSymbols(symbolTree: SymbolTree) {

        let kindMask = SymbolKind.Parameter | SymbolKind.Variable;
        let modifierMask = SymbolModifier.Anonymous | SymbolModifier.Private | SymbolModifier.Use;

        let predicate: Predicate<Symbol> = (s) => {
            return !(s.kind & kindMask) && !(s.modifiers & modifierMask);
        };

        return symbolTree.match(predicate, 2);

    }

}
