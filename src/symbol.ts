/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray, Map } from './types';
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

export class PhpSymbol {

    private _id;

    uri: string;
    start: number;
    end: number;
    scope: string;
    modifiers: SymbolModifier;
    description: string;
    associated: string[];
    type: TypeString;

    constructor(public kind: SymbolKind, public name: string) {
        this._id = Symbol(name);
    }

    get id() {
        return this._id;
    }

    isEqualTo(symbol: PhpSymbol) {
        return this.kind === symbol.kind &&
            this.name === symbol.name &&
            this.uri === symbol.uri &&
            this.scope === symbol.scope;
    }

    toString() {
        return this.name;
    }
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
    namespace: string;
    thisName: string;

    constructor(importTable: ImportTable) {
        this._importTable = importTable;
        this.namespace = '';
        this.thisName = '';
    }

    resolveRelative(relativeName: string) {
        return this.namespace ? this.namespace + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {

        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }

        let pos = notFqName.indexOf('\\');
        if (pos === -1) {
            return this._resolveUnqualified(notFqName, kind);
        } else {
            this._resolveQualified(name, pos, kind);
        }
    }

    private _resolveQualified(name: string, pos: number, kind: SymbolKind) {

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

export class TypeString {

    private static _classNamePattern: RegExp = /([\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff])*/g;

    private static _keywords: string[] = [
        'string', 'integer', 'int', 'boolean', 'bool', 'float',
        'double', 'object', 'mixed', 'array', 'resource',
        'void', 'null', 'callback', 'false', 'true', 'self'
    ];

    private _parts: string[];

    constructor(text: string) {
        this._parts = text ? this._chunk(text) : [];
    }

    isEmpty() {
        return this._parts.length < 1;
    }

    atomicClassArray() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }

        return parts;

    }

    arrayDereference() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];

            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                } else {
                    parts.push(part);
                }

            }

        }

        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;

    }

    array() {
        let text: string;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        } else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }

    merge(type: string | TypeString) {

        let parts = util.isString(type) ? this._chunk(<string>type) : (<TypeString>type)._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }

    nameResolve(nameResolver: NameResolver) {

        let replacer = (match, offset, text) => {

            if (TypeString._keywords.indexOf(match[0]) >= 0) {
                return match[0];
            } else if (match[0] === '\\') {
                return match.slice(1);
            } else {
                return nameResolver.resolveNotFullyQualified(match, SymbolKind.Class);
            }

        };

        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }

    toString() {
        return this._parts.join('|');
    }

    private _unique(parts: string[]) {
        let map: Map<string> = {};
        let part: string;

        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }

        return Object.keys(map);
    }

    private _chunk(typeString: string) {

        let n = 0;
        let parentheses = 0;
        let parts: string[] = [];
        let part: string = '';
        let c: string;

        while (n < typeString.length) {

            c = typeString[n];

            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    } else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }

            ++n;
        }

        if (part) {
            parts.push(part);
        }

        return parts;

    }


}

export class SymbolTree extends Tree<PhpSymbol> {

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

    get symbolTree() {
        return this._symbolTree;
    }

    get importTable() {
        return this._importTable;
    }

}

/**
 * Get suffixes after $, namespace separator, underscore and on capitals
 * Includes acronym using non namespaced portion of string
 */
function symbolSuffixes(node: Tree<PhpSymbol>) {
    let symbol = node.value;
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

    private _map: Map<DocumentSymbols>;
    private _index: SuffixArray<Tree<PhpSymbol>>;

    constructor() {
        this._map = {};
        this._index = new SuffixArray<Tree<PhpSymbol>>(symbolSuffixes);
    }

    getDocumentSymbols(uri: string) {
        return this._map[uri];
    }

    add(documentSymbols: DocumentSymbols) {
        if (this.getDocumentSymbols(documentSymbols.uri)) {
            throw new Error(`Duplicate key ${documentSymbols.uri}`);
        }
        this._map[documentSymbols.uri] = documentSymbols;
        this._index.addMany(this._externalSymbols(documentSymbols.symbolTree));
    }

    remove(uri: string) {
        let doc = this.getDocumentSymbols(uri);
        if (!doc) {
            return;
        }
        this._index.removeMany(this._externalSymbols(doc.symbolTree));
        delete this._map[uri];
    }

    /**
     * Matches external symbols only
     */
    match(text: string, kindMask?: SymbolKind) {
        let matched = this._index.match(text);

        if (!kindMask) {
            return matched;
        }

        let filtered: Tree<PhpSymbol>[] = [];
        let s: Tree<PhpSymbol>;

        for (let n = 0; n < matched.length; ++n) {
            s = matched[n];
            if ((s.value.kind & kindMask) > 0) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    private _externalSymbols(symbolTree: SymbolTree) {

        let notKindMask = SymbolKind.Parameter | SymbolKind.Variable;
        let notModifierMask = SymbolModifier.Anonymous | SymbolModifier.Private;

        let predicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return x.value !== null &&
                !(x.value.kind & notKindMask) &&
                !(x.value.modifiers & notModifierMask);
        };

        return symbolTree.match(predicate);

    }

}

interface ResolvedVariable {
    name: string;
    type: TypeString;
}

const enum ResolvedVariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface ResolvedVariableSet {
    kind: ResolvedVariableSetKind;
    vars: Map<ResolvedVariable>;
}

/**
 * Tracks variable type within a single scope
 */
export class ResolvedVariableTable {

    private _node: Tree<ResolvedVariableSet>;

    constructor(public uri: string) {
        this._node = new Tree<ResolvedVariableSet>({
            kind: ResolvedVariableSetKind.Scope,
            vars: {}
        });
    }

    setVariable(name: string, type: TypeString) {
        this._node.value.vars[name] = { name: name, type: type };
    }

    pushBranch() {
        let b = new Tree<ResolvedVariableSet>({
            kind: ResolvedVariableSetKind.Branch,
            vars: {}
        });
        this._node.addChild(b);
        this._node = b;
    }

    popBranch() {
        this._node = this._node.parent;
    }

    pushBranchGroup() {
        let b = new Tree<ResolvedVariableSet>({
            kind: ResolvedVariableSetKind.BranchGroup,
            vars: {}
        });
        this._node.addChild(b);
        this._node = b;
    }

    popBranchGroup() {

        //can consolidate variables and prune tree as at this point
        //each variable may be any of types discovered in branches 
        let b = this._node;
        this._node = b.parent;
        let consolidator = new TypeConsolidator(this._node.value.vars);
        b.traverse(consolidator);
        this._node.removeChild(b);

    }

    getType(varName: string) {

        let type: TypeString;
        let vars: Map<ResolvedVariable>;
        let node = this._node;

        while(node){

            if (node.value.vars.hasOwnProperty(varName)) {
                return node.value.vars[varName];
            } else {
                node = node.parent;
            }

        }

        return null;

    }

}

class TypeConsolidator implements TreeVisitor<ResolvedVariableSet> {

    constructor(public variables: Map<ResolvedVariable>) {

    }

    preOrder(node: Tree<ResolvedVariableSet>) {

        let keys = Object.keys(node.value.vars);
        let v: ResolvedVariable;
        let key: string;

        for (let n = 0; n < keys.length; ++n) {
            key = keys[n];
            v = node.value.vars[key];
            
            if (this.variables.hasOwnProperty(key)) {
                this.variables[key].type = this.variables[key].type.merge(v.type);
            } else {
                this.variables[key] = v;
            }
        }

        return true;

    }

}


