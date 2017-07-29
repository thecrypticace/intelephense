/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TypeString } from './typeString';
import { BinarySearch } from './types';
import { Location, Range } from 'vscode-languageserver-types';
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

export interface PhpSymbolDoc {
    description?: string;
    type?: string;
}

export namespace PhpSymbolDoc {
    export function create(description?: string, type?: string): PhpSymbolDoc {
        return {
            description: description || '',
            type: type || ''
        };
    }
}

export interface PhpSymbol extends SymbolIdentifier {
    location?: Location;
    modifiers?: SymbolModifier;
    doc?: PhpSymbolDoc;
    type?: string;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    value?: string;
    references?:Reference[];
}

export interface SymbolIdentifier {
    kind:SymbolKind;
    name:string;
    scope?:string;
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
        let paramType: string;

        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];

            if (n) {
                parts.push(',');
            }

            paramType = PhpSymbol.type(param);
            if (paramType) {
                parts.push(paramType);
            }

            parts.push(param.name);

            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            } else {
                paramStrings.push(parts.join(' '));
            }

        }

        let sig = `(${paramStrings.join('')})`;
        let sType = PhpSymbol.type(s);
        if (sType) {
            sig += `: ${sType}`;
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
            doc: s.doc,
            scope: s.scope,
            value: s.value
        };
    }

    export function type(s: PhpSymbol) {
        if (s.type) {
            return s.type;
        } else if (s.doc && s.doc.type) {
            return s.doc.type;
        } else {
            return '';
        }

    }

    export function setScope(symbols: PhpSymbol[], scope: string) {
        if (!symbols) {
            return symbols;
        }
        for (let n = 0; n < symbols.length; ++n) {
            symbols[n].scope = scope;
        }
        return symbols;
    }

    export function create(kind: SymbolKind, name: string, location?: Location): PhpSymbol {
        return {
            kind: kind,
            name: name,
            location: location
        };
    }

}

export interface Reference extends SymbolIdentifier {
    range: Range;
    type?: string;
    altName?: string;
}

export namespace Reference {
    export function create(kind: SymbolKind, name: string, range: Range) {
        return {
            kind: kind,
            name: name,
            range: range
        };
    }

    export function toTypeString(ref: Reference, symbolStore: SymbolStore, uri: string) {

        if (!ref) {
            return '';
        }

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                return ref.name;

            case SymbolKind.Function:
            case SymbolKind.Method:
            case SymbolKind.Property:
                return findSymbols(ref, symbolStore, uri).reduce<string>((carry, val) => {
                    return TypeString.merge(carry, PhpSymbol.type(val));
                }, '');

            case SymbolKind.Variable:
                return ref.type || '';

            default:
                return '';


        }
    }

    export function findSymbols(ref: Reference, symbolStore: SymbolStore, uri: string) {

        if (!ref) {
            return [];
        }

        let symbols: PhpSymbol[];
        let fn: Predicate<PhpSymbol>;
        let lcName: string;
        let table: SymbolTable;

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                fn = (x) => {
                    return (x.kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait)) > 0;
                };
                symbols = symbolStore.find(ref.name, fn);
                break;

            case SymbolKind.Function:
            case SymbolKind.Constant:
                fn = (x) => {
                    return x.kind === ref.kind;
                };
                symbols = symbolStore.find(ref.name, fn);
                if (symbols.length < 1 && ref.altName) {
                    symbols = symbolStore.find(ref.altName, fn);
                }
                break;

            case SymbolKind.Method:
                lcName = ref.name.toLowerCase();
                fn = (x) => {
                    return x.kind === SymbolKind.Method && x.name.toLowerCase() === lcName;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Property:
                fn = (x) => {
                    return x.kind === SymbolKind.Property && x.name.slice(1) === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.ClassConstant:
                fn = (x) => {
                    return x.kind === SymbolKind.ClassConstant && x.name === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Variable:
                table = symbolStore.getSymbolTable(uri);
                if (table) {
                    //find the var scope
                    fn = (x) => {
                        return ((x.kind === SymbolKind.Function && (x.modifiers & SymbolModifier.Anonymous) > 0) ||
                            x.kind === SymbolKind.Method) &&
                            x.location && util.isInRange(ref.range.start, x.location.range.start, x.location.range.end) === 0;
                    };
                    let scope = table.find(fn);
                    if (!scope) {
                        scope = table.root;
                    }
                    fn = (x) => {
                        return (x.kind & (SymbolKind.Parameter | SymbolKind.Variable)) > 0 &&
                            x.name === ref.name;
                    }
                    let s = scope.children ? scope.children.find(fn) : null;
                    if (s) {
                        symbols = [s];
                    }
                }
                break;

            default:
                break;

        }

        return symbols || [];

    }

    function findMembers(symbolStore: SymbolStore, scope: string, predicate: Predicate<PhpSymbol>) {

        let fqnArray = TypeString.atomicClassArray(scope);
        let type: TypeAggregate;
        let members = new Set<PhpSymbol>();
        for (let n = 0; n < fqnArray.length; ++n) {
            type = TypeAggregate.create(symbolStore, fqnArray[n]);
            if (type) {
                Set.prototype.add.apply(members, type.members(predicate));
            }
        }
        return Array.from(members);
    }

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

    /**
     * Matches all items that are prefixed with text
     * @param text 
     */
    match(text: string) {

        text = text.toLowerCase();
        let nodes = this._nodeMatch(text);
        let matches = new Set<PhpSymbol>();

        for (let n = 0; n < nodes.length; ++n) {
            Set.prototype.add.apply(matches, nodes[n].items);
        }

        return Array.from(matches);

    }

    /**
     * Finds all items that match text exactly
     * @param text 
     */
    find(text: string) {
        let node = this._nodeFind(text.toLowerCase());
        return node ? node.items : [];
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

    private _nodeFind(lcText: string) {

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
    doc?: PhpSymbolDoc;
    type?: string;
    associated?: PhpSymbolDto[];
    children?: PhpSymbolDto[];
    scope?: string;
    value?: string;
}


