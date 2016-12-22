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
    private _namespaceStack: string[];
    namespace: string;

    constructor(importTable: ImportTable) {
        this._importTable = importTable;
        this._namespaceStack = [];
        this.namespace = '';
    }

    resolveRelative(relativeName: string) {
        return this.namespace ? this.namespace + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {
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
                }
                parts.push(part);
            }

        }

        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;

    }

    merge(type: string | TypeString) {

        let parts = util.isString(type) ? this._chunk(<string>type) : (<TypeString>type)._parts;
        Array.prototype.push.apply(parts, this._parts);
        let map: Map<string> = {};
        let part: string;

        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }

        let newTypeString = new TypeString(null);
        newTypeString._parts = Object.keys(map);
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

}

/**
 * Get suffixes after $, namespace separator, underscore and on capitals
 * Includes acronym using non namespaced portion of string
 */
function symbolSuffixes(symbol: PhpSymbol) {
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
    private _index: SuffixArray<PhpSymbol>;

    constructor() {
        this._map = {};
        this._index = new SuffixArray<PhpSymbol>(symbolSuffixes);
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
        let map: { [index: string]: PhpSymbol } = {};
        let uid: string;
        let uniqueSymbols: PhpSymbol[] = [];
        let s: PhpSymbol;

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

        let predicate: Predicate<PhpSymbol> = (s) => {
            return !(s.kind & kindMask) && !(s.modifiers & modifierMask);
        };

        return symbolTree.match(predicate, 2);

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

export class ResolvedVariableTable {

    private _path: Tree<ResolvedVariableSet>[];

    constructor(public uri: string) {
        this._path = [new Tree<ResolvedVariableSet>({ kind: ResolvedVariableSetKind.Scope, vars: {} })];
    }

    addVariable(name: string, type: TypeString) {
        let vars = util.top<Tree<ResolvedVariableSet>>(this._path).value.vars;

        if (vars.hasOwnProperty(name)) {
            vars[name].type = vars[name].type.merge(type);
        } else {
            vars[name] = { name: name, type: type };
        }
    }

    pushBranch() {
        let b = new Tree<ResolvedVariableSet>({ kind: ResolvedVariableSetKind.Branch, vars: {} });
        util.top<Tree<ResolvedVariableSet>>(this._path).addChild(b);
        this._path.push(b);
    }

    popBranch() {
        this._path.pop();
    }

    pushBranchGroup() {
        let b = new Tree<ResolvedVariableSet>({ kind: ResolvedVariableSetKind.BranchGroup, vars: {} });
        util.top<Tree<ResolvedVariableSet>>(this._path).addChild(b);
        this._path.push(b);
    }

    popBranchGroup() {

        //can consolidate variables and prune tree as at this point
        //each variable may be any of types discovered in branches 
        let b = this._path.pop();
        let top = util.top(this._path);
        let consolidator = new TypeConsolidator(top.value.vars);
        b.traverse(consolidator);
        top.removeChild(b);

    }

    /**
     * @param {string[]} carry  names of variables that should cross scope (closures)
     */
    pushScope(carry: string[] = null) {
        let s = new Tree<ResolvedVariableSet>({ kind: ResolvedVariableSetKind.Scope, vars: {} });

        if (carry !== null) {

            let parentScope = this._path[this._scopeIndex()];
            let types = parentScope.value.vars;
            let v: ResolvedVariable;
            let varName: string
            for (let n = 0; n < carry.length; ++n) {
                varName = carry[n];
                if (types.hasOwnProperty(varName)) {
                    s.value.vars[varName] = { name: varName, type: v.type };
                }
            }
        }

        util.top<Tree<ResolvedVariableSet>>(this._path).addChild(s);
        this._path.push(s);
    }

    popScope() {
        this._path.pop();
    }

    getType(varName: string) {

        let type: TypeString;
        let vars: Map<ResolvedVariable>;

        for (let n = this._scopeIndex(); n < this._path.length; ++n) {
            vars = this._path[n].value.vars;
            if (vars.hasOwnProperty(varName)) {
                type = type ? type.merge(vars[varName].type) : vars[varName].type;
            }

        }

        return type;
    }

    private _scopeIndex() {

        let n = this._path.length;
        while (n--) {
            if (this._path[n].value.kind === ResolvedVariableSetKind.Scope) {
                return n;
            }
        }

        throw new Error('Scope not found');

    }

}

class TypeConsolidator implements TreeVisitor<ResolvedVariableSet> {

    constructor(public variables: Map<ResolvedVariable> = {}) {

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

    }

    shouldDescend() {
        return true;
    }

}


