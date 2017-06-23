/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TypeString } from './typeString';
import { BinarySearch } from './types';
import { Location } from 'vscode-languageserver-types';
import * as util from './util';

export const enum SymbolKind {
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
    Namespace = 1 << 9,
    ClassConstant = 1 << 10
}

export const enum SymbolModifier {
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
    Anonymous = 1 << 9,
    Reference = 1 << 10,
    Variadic = 1 << 11,
    Use = 1 << 12
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


export namespace PhpSymbol {

    function isParameter(s: PhpSymbol) {
        return s.kind === SymbolKind.Parameter;
    }

    export function signatureString(s: PhpSymbol) {

        if (!s || !(s.kind & (SymbolKind.Function | SymbolKind.Method))) {
            return '';
        }

        let params = s.children ? s.children.filter(isParameter) : [];
        let paramStrings: String[] = [];
        let param: PhpSymbol;
        let parts: string[];

        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];

            if (n) {
                parts.push(',');
            }

            if (param.type && !param.type.isEmpty()) {
                parts.push(param.type.toString());
            }

            parts.push(param.name);

            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            } else {
                paramStrings.push(parts.join(' '));
            }

        }

        let sig = `(${paramStrings.join('')})`;
        if (s.type && !s.type.isEmpty()) {
            sig += `: ${s.type}`;
        }
        return sig;

    }

    export function hasParameters(s: PhpSymbol) {
        return s.children && s.children.find(isParameter) !== undefined;
    }

    export function notFqn(text: string) {
        if (!text) {
            return text;
        }
        let pos = text.lastIndexOf('\\') + 1;
        return text.slice(pos);
    }

    /**
     * Shallow clone
     * @param s 
     */
    export function clone(s: PhpSymbol): PhpSymbol {
        return {
            kind: s.kind,
            name: s.name,
            children: s.children,
            location: s.location,
            modifiers: s.modifiers,
            associated: s.associated,
            type: s.type,
            typeSource: s.typeSource,
            description: s.description,
            scope: s.scope,
            value: s.value
        };
    }

}

export const enum TypeSource {
    None,
    TypeDeclaration
}

export class SymbolIndex {

    private _nodeArray: SymbolIndexNode[];
    private _binarySearch: BinarySearch<SymbolIndexNode>;
    private _collator: Intl.Collator;

    constructor() {
        this._nodeArray = [];
        this._binarySearch = new BinarySearch<SymbolIndexNode>(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }

    add(item: PhpSymbol) {

        let suffixes = this._symbolKeys(item);
        let node: SymbolIndexNode;

        for (let n = 0; n < suffixes.length; ++n) {

            node = this._nodeFind(suffixes[n]);

            if (node) {
                node.items.push(item);
            } else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }

    }

    addMany(items: PhpSymbol[]) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }

    remove(item: PhpSymbol) {

        let suffixes = this._symbolKeys(item);
        let node: SymbolIndexNode;
        let i: number;

        for (let n = 0; n < suffixes.length; ++n) {

            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }

            i = node.items.indexOf(item);

            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    //uneccessary? save a lookup and splice
                    //this._deleteNode(node);
                }
            }

        }

    }

    removeMany(items: PhpSymbol[]) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }

    match(text: string, fuzzy?: boolean) {

        text = text.toLowerCase();
        let substrings: string[];

        if (fuzzy) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
        } else {
            substrings = [text];
        }

        let nodes: SymbolIndexNode[] = [];

        for (let n = 0, l = substrings.length; n < l; ++n) {
            Array.prototype.push.apply(nodes, this._nodeMatch(text));
        }

        let matches: PhpSymbol[] = [];

        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }

        if (fuzzy) {
            return this._sortedFuzzyResults(text, matches);
        } else {
            return Array.from(new Set<PhpSymbol>(matches));
        }

    }

    private _sortedFuzzyResults(query: string, matches: PhpSymbol[]) {

        let map: { [index: string]: number } = {};
        let s: PhpSymbol;
        let name: string;
        let checkIndexOf = query.length > 3;
        let val: number;

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = 0;
                if (checkIndexOf) {
                    val = (PhpSymbol.notFqn(s.name).indexOf(query) + 1) * -10;
                    if (val < 0) {
                        val += 1000;
                    }
                }
                map[name] = val;
            }
            ++map[name];
        }

        let unique = Array.from(new Set(matches));

        let sortFn = (a: PhpSymbol, b: PhpSymbol) => {
            return map[b.name] - map[a.name];
        }

        unique.sort(sortFn);
        return unique;

    }

    private _nodeMatch(lcText: string) {

        let collator = this._collator;
        let compareLowerFn = (n: SymbolIndexNode) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n: SymbolIndexNode) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        }

        return this._binarySearch.range(compareLowerFn, compareUpperFn);

    }

    private _nodeFind(text: string) {

        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n: SymbolIndexNode) => {
            return collator.compare(n.key, lcText);
        }

        return this._binarySearch.find(compareFn);

    }

    private _insertNode(node: SymbolIndexNode) {

        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });

        this._nodeArray.splice(rank, 0, node);

    }

    private _deleteNode(node: SymbolIndexNode) {

        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });

        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }

    }

    private _symbolKeys(s: PhpSymbol) {

        if (s.kind === SymbolKind.Namespace) {
            return this._namespaceSymbolKeys(s);
        }

        let notFqnPos = s.name.lastIndexOf('\\') + 1;
        let notFqn = s.name.slice(notFqnPos);
        let lcNotFqn = notFqn.toLowerCase();
        let lcFqn = s.name.toLowerCase();

        let keys = util.trigrams(lcNotFqn);
        if (lcNotFqn) {
            keys.add(lcNotFqn);
        }

        keys.add(lcFqn);

        let acronym = util.acronym(notFqn);
        if (acronym.length > 1) {
            keys.add(acronym);
        }
        return Array.from(keys);
    }

    private _hasLength(text: string) {
        return text.length > 0;
    }

    private _namespaceSymbolKeys(s: PhpSymbol) {
        if (!s.name) {
            return [];
        }

        let lcName = s.name.toLowerCase();
        let keys = [lcName];
        Array.prototype.push.apply(keys, lcName.split('\\').filter(this._hasLength));
        return keys;
    }

}

interface SymbolIndexNode {
    key: string;
    items: PhpSymbol[];
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


