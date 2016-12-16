/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { NonTerminal, NonTerminalType, NonTerminalFlag, Token } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag } from './parse';
import * as util from './util';

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
    Anonymous = 1 << 9
}

export class Symbol {

    uri: string;
    start: number;
    end: number;
    scope: string;
    modifiers: SymbolModifier;
    description: string;
    associated: string[];
    type: string;

    constructor(public kind: SymbolKind, public name: string) { }

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

interface RangedTypes {
    types: string;
    start: number;
    end: number;
}

export interface ImportRule {
    kind: SymbolKind;
    name: string;
    fqn: string;
}

export class ImportTable {

    private _rules: ImportRule[];
    private _uri: string;

    constructor(uri: string, importRules: ImportRule[] = []) {
        this._uri = uri;
        this._rules = importRules;
    }

    get uri() {
        return this._uri;
    }

    addRule(rule: ImportRule) {
        this._rules.push(rule);
    }

    addRuleMany(rules: ImportRule[]) {
        Array.prototype.push.apply(this._rules, rules);
    }

    match(text: string, kind: SymbolKind) {
        let r: ImportRule;
        for (let n = 0; n < this._rules.length; ++n) {
            r = this._rules[n];
            if (r.kind === kind && text === r.name) {
                return r;
            }
        }
        return null;
    }

}

export class NameResolver {

    private _importTable: ImportTable;
    private _namespaceStack: string[];

    constructor(importTable: ImportTable) {
        this._importTable = importTable;
        this._namespaceStack = [];
    }

    namespace() {
        return util.top(this._namespaceStack);
    }

    pushNamespace(name: string) {
        this._namespaceStack.push(name);
    }

    popNamespace() {
        this._namespaceStack.pop();
    }

    resolveRelative(relativeName: string) {
        let ns = this.namespace();
        return ns ? ns + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {
        let pos = notFqName.indexOf('\\');
        if (pos === -1) {
            return this._resolveUnqualified(notFqName, kind);
        } else {
            this._resolveQualified(name, pos, kind);
        }
    }

    private _resolveQualified(name: string, pos: number, kind:SymbolKind) {

        let rule = this._importTable.match(name.slice(0, pos), kind);
        if (rule) {
            return rule.fqn + name.slice(pos);
        } else {
            return this.resolveRelative(name);
        }

    }

    private _resolveUnqualified(name: string, kind: SymbolKind) {

        let rule = this._importTable.match(name, kind);
        if (rule) {
            return rule.fqn;
        } else {

            /*
                http://php.net/manual/en/language.namespaces.rules.php
                For unqualified names, if no import rule applies and the name refers to a 
                function or constant and the code is outside the global namespace, the name is 
                resolved at runtime. Assuming the code is in namespace A\B, here is how a call 
                to function foo() is resolved:

                It looks for a function from the current namespace: A\B\foo().
                It tries to find and call the global function foo().
            */

            return this.resolveRelative(name);
        }

    }

}

export class PhpDocTypeString {

    private static _classNamePattern: RegExp = /([\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff])*/g;

    private static _keywords: string[] = [
        'string', 'integer', 'int', 'boolean', 'bool', 'float',
        'double', 'object', 'mixed', 'array', 'resource',
        'void', 'null', 'callback', 'false', 'true', 'self'
    ];

    static atomicClassArray(typeString: string) {

        let n = 0;
        let types: string[] = [];
        let parentheses = 0;
        let skipUntilPipe = false;
        let type: string = '';

        while (n < typeString.length) {

            switch (typeString[n]) {
                case '|':
                    if (parentheses) {
                        break;
                    }
                    skipUntilPipe = false;
                    if (type && PhpDocTypeString._keywords.indexOf(type) === -1) {
                        types.push(type);
                        type = '';
                    }
                    break;
                case '(':
                    skipUntilPipe = true;
                    ++parentheses;
                    break;
                case ')':
                    --parentheses;
                    break;
                case '[':
                    type = '';
                    skipUntilPipe = true;
                    break;
                default:
                    if (!skipUntilPipe) {
                        type += typeString[n];
                    }
                    break;
            }

            ++n;
        }

        if (type && PhpDocTypeString._keywords.indexOf(type) === -1) {
            types.push(type);
        }

        return types;

    }

    static arrayDereference(typeString: string) {

        let n = 0;
        let parentheses = 0;
        let text = '';
        let c: string;
        let parts: string[] = [];

        while (n < typeString.length) {

            c = typeString[n];

            switch (c) {
                case '|':
                    if (parentheses) {
                        text += c;
                        break;
                    }

                    text = PhpDocTypeString._arrayDereferenceType(text);
                    if (text) {
                        parts.push(text);
                        text = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    text += c;
                    break;
                case ')':
                    --parentheses;
                    text += c;
                    break;
                default:
                    text += c;
                    break;
            }

            ++n;
        }

        text = PhpDocTypeString._arrayDereferenceType(text);
        if (text) {
            parts.push(text);
        }

        return parts.join('|');

    }

    private static _arrayDereferenceType(typeString: string) {
        if (typeString.slice(-2) === '[]') {
            typeString = typeString.slice(0, -2);
            if (typeString.slice(-1) === ')') {
                typeString = typeString.slice(1, -1);
            }
            return typeString;
        }
        return '';
    }

    static concat(prefix: string, suffix: string) {
        return prefix ? prefix + '|' + suffix : suffix;
    }

    static nameResolve(typeString: string, nameResolver: NameResolver) {
        return typeString.replace(PhpDocTypeString._classNamePattern, (match, offset, text) => {
            return match[0] === '\\' ? match.slice(1) : nameResolver.resolveNotFullyQualified(match, SymbolKind.Class);
        });
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

    toArray() {
        let symbols = super.toArray();
        symbols.shift(); //root has null value
        return symbols;
    }

}

export class DocumentSymbols {

    private _importTable: ImportTable;
    private _symbolTree: SymbolTree;
    private _uri: string;

    constructor(uri: string, importTable: ImportTable, symbolTree: SymbolTree) {
        this._uri = uri;
        this._importTable = importTable;
        this._symbolTree = symbolTree;
    }

    get uri() {
        return this._uri;
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
        } else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
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

    private _map: { [uri: string]: DocumentSymbols };
    private _index: SuffixArray<Symbol>;

    constructor() {
        this._map = {};
        this._index = new SuffixArray<Symbol>(symbolSuffixes);
    }

    getDocumentSymbols(uri: string) {
        return this._map[uri];
    }

    add(documentSymbols: DocumentSymbols) {
        if (this.getDocumentSymbols(documentSymbols.uri)) {
            throw new Error(`Duplicate key ${documentSymbols.uri}`);
        }
        this._map[documentSymbols.uri] = documentSymbols;
        this._index.addMany(this._externalSymbols(documentSymbols));
    }

    remove(uri: string) {
        let doc = this.getDocumentSymbols(uri);
        if (!doc) {
            return;
        }
        this._index.removeMany(this._externalSymbols(doc));
        delete this._map[uri];
    }

    /**
     * Matches external symbols only
     */
    match(text: string) {
        let symbols = this._index.match(text);
        let map: { [index: string]: Symbol } = {};
        let uid: string;
        let uniqueSymbols: Symbol[] = [];
        let s: Symbol;

        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            uid = s.uid;
            if (!map[uid]) {
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


