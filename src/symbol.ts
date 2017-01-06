/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { Phrase, PhraseType, PhraseFlag, Token } from 'php7parser';
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
    Anonymous = 1 << 9,
    Reference = 1 << 10,
    Variadic = 1 << 11,
    Use = 1 << 12
}

export interface PhpSymbol {

    kind: SymbolKind;
    name: string;
    uri?: string;
    start?: number;
    end?: number;
    modifiers?: SymbolModifier;
    description?: string;
    type?: TypeString;
    returnType?: TypeString;
    extends?: string[];
    implements?: string[];
    traits?: string[];
    signature?: string;

}

export interface ImportRule {
    kind: SymbolKind;
    alias: string;
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
        let name: string;
        for (let n = 0; n < this._rules.length; ++n) {
            r = this._rules[n];
            name = r.alias ? r.alias : this._lastNamespaceNamePart(r.fqn);
            if (r.kind === kind && text === name) {
                return r;
            }
        }
        return null;
    }

    private _lastNamespaceNamePart(text: string) {
        let pos = text.lastIndexOf('\\');
        return pos >= 0 ? text.slice(pos + 1) : text;
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
        if (!relativeName) {
            return '';
        }
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
        let map: { [index: string]: string } = {};
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

export class SymbolTree {

    static parametersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Parameter;
    };

    static closureUseVariablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable &&
            (x.value.modifiers & SymbolModifier.Use) > 0;
    };

    static variablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable;
    };

    static instanceExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static staticInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
                x.value.kind === SymbolKind.Method ||
                x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static parameters(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.parametersPredicate);
    }

    static closureUseVariables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.closureUseVariablesPredicate);
    }

    static variables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.variablesPredicate);
    }

}

export class DocumentSymbols {

    private _importTable: ImportTable;
    private _symbolTree: Tree<PhpSymbol>;
    private _uri: string;

    constructor(uri: string, importTable: ImportTable, symbolTree: Tree<PhpSymbol>) {
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

    private _map: { [index: string]: DocumentSymbols };
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
        this._index.addMany(this._indexSymbols(documentSymbols.symbolTree));
    }

    remove(uri: string) {
        let doc = this.getDocumentSymbols(uri);
        if (!doc) {
            return;
        }
        this._index.removeMany(this._indexSymbols(doc.symbolTree));
        delete this._map[uri];
    }

    /**
     * Matches any symbol by name or partial name (excluding parameters and variables) 
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

    lookupTypeMembers(typeName:string, predicate:Predicate<Tree<PhpSymbol>>){
        let type = this.match(typeName, SymbolKind.Class | SymbolKind.Interface).shift();
        return this._lookupTypeMembers(type, predicate);
    }

    lookupTypeMember(typeName:string, predicate: Predicate<Tree<PhpSymbol>>) {
        return this.lookupTypeMembers(typeName, predicate).shift();
    }

    private _lookupTypeMembers(type: Tree<PhpSymbol>, predicate: Predicate<Tree<PhpSymbol>>) {

        if(!type){
            return [];
        }

        let members = type.children.filter(predicate);
        let memberNames = members.map((x)=>{
            return x.value.name;
        });

        let associatedNames:string[] = [];
        
        if(type.value.extends){
            Array.prototype.push.apply(associatedNames, type.value.extends);
        }
        
        if(type.value.traits){
            Array.prototype.push.apply(associatedNames, type.value.traits);
        }

        //lookup in base class/traits
        let associated: Tree<PhpSymbol>;
        let baseKindMask = type.value.kind === SymbolKind.Class ? SymbolKind.Class | SymbolKind.Trait : SymbolKind.Interface;
        let basePredicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return predicate(x) && !(x.value.modifiers & SymbolModifier.Private) && memberNames.indexOf(x.value.name) < 0;
        };

        for (let n = 0; n < associatedNames.length; ++n) {
            associated = this.match(associatedNames[n], baseKindMask).shift();
            if (associated) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(associated, basePredicate));
            }

        }

        return members;
    }

    private _indexSymbols(symbolTree: Tree<PhpSymbol>) {

        let notKindMask = SymbolKind.Parameter | SymbolKind.Variable;

        let predicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return x.value && !(x.value.kind & notKindMask);
        };

        return symbolTree.match(predicate);

    }

}

interface ResolvedVariable {
    name: string;
    type: TypeString;
}

const enum VariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface VariableSet {
    kind: VariableSetKind;
    vars: { [index: string]: ResolvedVariable };
}

/**
 * Tracks variable type
 */
export class VariableTable {

    private _node: Tree<VariableSet>;
    private _thisTypeStack: TypeString[];

    constructor() {
        this._node = new Tree<VariableSet>({
            kind: VariableSetKind.Scope,
            vars: {}
        });
        this._thisTypeStack = [];
    }

    setType(varName: string, type: TypeString) {
        this._node.value.vars[varName] = { name: varName, type: type };
    }

    pushThisType(thisType: TypeString) {
        this._thisTypeStack.push(thisType);
    }

    popThisType() {
        this._thisTypeStack.pop();
    }

    pushScope(carry: string[] = null) {

        let resolvedVariables: ResolvedVariable[] = [];
        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    resolvedVariables.push({ name: carry[n], type: type });
                }
            }
        }

        this._pushNode(VariableSetKind.Scope);
        for (let n = 0; n < resolvedVariables.length; ++n) {
            this.setType(resolvedVariables[n].name, resolvedVariables[n].type);
        }
    }

    popScope() {
        this._node = this._node.parent;
    }

    pushBranch() {
        this._pushNode(VariableSetKind.Branch);
    }

    popBranch() {
        this._node = this._node.parent;
    }

    pushBranchGroup() {
        this._pushNode(VariableSetKind.BranchGroup);
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
        let vars: { [index: string]: ResolvedVariable };
        let node = this._node;

        if (varName === '$this') {
            return util.top<TypeString>(this._thisTypeStack);
        }

        while (node) {

            if (node.value.vars.hasOwnProperty(varName)) {
                return node.value.vars[varName].type;
            } else if (node.value.kind !== VariableSetKind.Scope) {
                node = node.parent;
            } else {
                break;
            }

        }

        return null;

    }

    private _pushNode(kind: VariableSetKind) {
        let node = new Tree<VariableSet>({
            kind: kind,
            vars: {}
        });
        this._node = this._node.addChild(node);
    }

}

class TypeConsolidator implements TreeVisitor<VariableSet> {

    constructor(public variables: { [index: string]: ResolvedVariable }) {

    }

    preOrder(node: Tree<VariableSet>) {

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


