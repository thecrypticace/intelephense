/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { AstNode, AstNodeType, AstNodeFlag, Token } from 'php7parser';
import {DocBlockParser, DocBlock, Tag, MethodTagParam, TypeTag} from './parse';

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
    kind: SymbolKind;
    name: string;
    uri: string;
    start: number;
    end: number;
    scope: string;
    modifiers: SymbolModifier;
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

    pushNamespace(name: string) {
        this._namespaceStack.push(name);
    }

    popNamespace() {
        this._namespaceStack.pop();
    }

    resolveRelative(relativeName: string) {
        let ns = this._namespace();
        return ns ? ns + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {
        let pos = notFqName.indexOf('\\');
        if (pos === -1) {
            return this._resolveUnqualified(notFqName, kind);
        } else {
            this._resolveQualified(name, pos);
        }
    }

    private _resolveQualified(name: string, pos: number) {

        let rule = this._importTable.match(name.slice(0, pos), SymbolKind.Class);
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

    private _namespace() {
        return this._namespaceStack.length ? this._namespaceStack[this._namespaceStack.length - 1] : '';
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

export class SymbolReaderFirstPass implements TreeVisitor<AstNode | Token> {

    private _stack: any[];
    private _importTable: ImportTable;
    private _nameResolver: NameResolver;
    private _docBlockParser:DocBlockParser;

    constructor(importTable: ImportTable, nameResolver: NameResolver, docBlockParser:DocBlockParser) {
        this._importTable = importTable;
        this._nameResolver = nameResolver;
        this._docBlockParser = docBlockParser;
        this._stack = [];
    }


    preOrder(node) {

    }

    inOrder(node, childIndex) {

        if (node && node.astNodeType === AstNodeType.Namespace && childIndex === 0) {
            let ns = this._top();
            if (ns) {
                this._nameResolver.pushNamespace(ns);
            }
        }

    }

    postOrder(node, childCount) {

        if (!node) {
            this._stack.push(null);
        }

        switch (node.astNodeType) {
            case AstNodeType.NamespaceName:
                this._stack.push(this._popMany(childCount).join('\\'));
                break;
            case AstNodeType.Namespace:
                this._postOrderNamespace(node, childCount);
                break;
            case AstNodeType.UseElement:
                this._postOrderUseElement(node, childCount);
                break;
            case AstNodeType.UseList:
                this._postOrderUseList(node, childCount);
                break;
            case AstNodeType.UseStatement:
                this._postOrderUseStatement(node, childCount);
                break;
            case AstNodeType.UseGroup:
                this._postOrderUseGroup(node, childCount);
                break;
            case AstNodeType.FunctionDeclaration:
                this._postOrderFunctionDeclaration(node,childCount);
                break;
            case undefined:
                //Token
                this._stack.push((<Token>node).text);
            default:
                this._popMany(childCount);
                this._stack.push(null);
                break;
        }

    }

    shouldDescend(node) {

        if (!node) {
            return false;
        }

        switch (node.astNodeType) {
            case AstNodeType.NamespaceName:
            case AstNodeType.Namespace:
                return true;
            default:
                return false;
        }
    }

    private _postOrderFunctionDeclaration(node:AstNode, childCount:number){

        let name:string, params:Tree<Symbol>[], returnType:string, body:null;
        [name, params, returnType, body] = this._popMany(4);
        if(!name){
            this._stack.push(null);
            return;
        }
        let s = new CallableSymbol(SymbolKind.Function, this._nameResolver.resolveRelative(name));
        if(returnType){
            s.returnTypes = [returnType];
        }

        let tree = new Tree<Symbol>(s);
        tree.addChildren(params);
        let doc = node.doc ? this._docBlockParser.parse(node.doc.text) : null;

        if(!node.doc){
            this._stack.push(tree);
            return;
        }

        

    }

    private _assignDocBlockInfoToCallableSymbol(func:CallableSymbol, params:Tree<VariableSymbol>[], doc:DocBlock){

        func.description = doc.text;
        let tag:TypeTag;
        let paramMap:{[name:string]:VariableSymbol} = {};
        let s:VariableSymbol;

        for(let n = 0; n < params.length; ++n){
            s = params[n].value;
            paramMap[s.name] = s;
        }

        for(let n = 0; n < doc.tags.length; ++n){
            tag = doc.tags[n] as TypeTag;
            if(tag.tagName === '@param'){
                if(paramMap[tag.name])
            } else if(tag.tagName === '@return'){
                if(!func.returnTypes){
                    func.returnTypes = tag.types;
                } else {
                    Array.prototype.push.apply(func.returnTypes, tag.types);
                }
            }
        }

    }

    private _postOrderUseGroup(node: AstNode, childCount) {
        let prefix: string, list: ImportRule[];
        let kind = this._useFlagToSymbolKind(node.flag);
        [prefix, list] = this._popMany(2);
        let rule: ImportRule;

        for (let n = 0; n < list.length; ++n) {
            rule = list[n];
            if (prefix) {
                rule.fqn = prefix + '\\' + rule.fqn;
            }
            if (kind) {
                rule.kind = kind;
            }
        }
        this._importTable.addRuleMany(list);
        this._stack.push(null);
    }

    private _postOrderUseStatement(node: AstNode, childCount) {
        let list = this._stack.pop() as ImportRule[];
        let kind = this._useFlagToSymbolKind(node.flag);
        for (let n = 0; n < list.length; ++n) {
            list[n].kind = kind;
        }
        this._importTable.addRuleMany(list);
        this._stack.push(null);
    }

    private _postOrderUseList(node: AstNode, childCount: number) {
        this._stack.push(this._popMany(childCount).filter((v, i, a) => { return v; }));
    }

    private _postOrderUseElement(node: AstNode, childCount: number) {
        let fqn: string, name: string;
        [fqn, name] = this._popMany(2);
        if (fqn) {
            this._stack.push({
                kind: this._useFlagToSymbolKind(node.flag),
                fqn: fqn,
                name: name
            });
        } else {
            this._stack.push(null);
        }
    }

    private _postOrderNamespace(node: AstNode, childCount: number) {
        let name: string, list: Tree<Symbol>[];
        [name, list] = this._popMany(2);
        let nodes: Tree<Symbol>[] = [];

        if (name) {
            let s = new Symbol(SymbolKind.Namespace, name);
            s.start = s.end = node.range.start.line;
            nodes.push(new Tree<Symbol>(s));
        }

        if (list) {
            Array.prototype.push.apply(nodes, list);
            if (name) {
                this._nameResolver.popNamespace();
            }
        }

        this._stack.push(nodes);
    }

    private _useFlagToSymbolKind(flag: AstNodeFlag) {
        switch (flag) {
            case AstNodeFlag.UseClass:
                return SymbolKind.Class;
            case AstNodeFlag.UseConstant:
                return SymbolKind.Constant;
            case AstNodeFlag.UseFunction:
                return SymbolKind.Function;
            default:
                return 0;
        }
    }

    private _popMany(n: number) {

        let popped: any[] = [];
        while (n--) {
            popped.push(this._stack.pop());
        }
        return popped.reverse();
    }

    private _top() {
        return this._stack.length ? this._stack[this._stack.length - 1] : null;
    }

}


