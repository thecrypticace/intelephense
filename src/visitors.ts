/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { NonTerminal, NonTerminalType, NonTerminalFlag, Token } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag } from './parse';
import * as util from './util';
import {Symbol, NameResolver, ImportRule, ImportTable, SymbolKind, PhpDocTypeString} from './symbol';

export class ImportTableReader implements TreeVisitor<NonTerminal | Token> {

    private _stack: any[];

    constructor(public importTable: ImportTable) {
        this._stack = [];
    }

    postOrder(node:Tree<NonTerminal>) {

        if (!node.value) {
            this._stack.push(null);
        }

        switch (node.value.nonTerminalType) {
            case NonTerminalType.NamespaceName:
                this._stack.push(util.popMany(this._stack, node.children.length).join('\\'));
                break;
            case NonTerminalType.UseElement:
                this._postOrderUseElement(node);
                break;
            case NonTerminalType.UseList:
                this._postOrderUseList(node);
                break;
            case NonTerminalType.UseStatement:
                this._postOrderUseStatement(node);
                break;
            case NonTerminalType.UseGroup:
                this._postOrderUseGroup(node);
                break;
            default:
                break;
        }
    }

    shouldDescend(node) {

        if (!node) {
            return false;
        }

        switch (node.nonTerminalType) {
            case NonTerminalType.TopStatementList:
            case NonTerminalType.UseElement:
            case NonTerminalType.UseList:
            case NonTerminalType.UseStatement:
            case NonTerminalType.UseGroup:
            case NonTerminalType.NamespaceName:
            case NonTerminalType.Namespace:
                return true;
            default:
                return false;
        }
    }

    private _postOrderUseGroup(node: Tree<NonTerminal>) {
        let prefix: string, list: ImportRule[];
        let kind = this._useFlagToSymbolKind(node.value.flag);
        [prefix, list] = util.popMany(this._stack, 2);
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
        this.importTable.addRuleMany(list);
    }

    private _postOrderUseStatement(node: Tree<NonTerminal>) {
        let list = this._stack.pop() as ImportRule[];
        let kind = this._useFlagToSymbolKind(node.value.flag);
        for (let n = 0; n < list.length; ++n) {
            list[n].kind = kind;
        }
        this.importTable.addRuleMany(list);
    }

    private _postOrderUseList(node: Tree<NonTerminal>) {
        this._stack.push(util.popMany(this._stack, node.children.length).filter((v, i, a) => { return v; }));
    }

    private _postOrderUseElement(node: Tree<NonTerminal>) {
        let fqn: string, name: string;
        [fqn, name] = util.popMany(this._stack, 2);
        if (fqn) {
            this._stack.push({
                kind: this._useFlagToSymbolKind(node.value.flag),
                fqn: fqn,
                name: name
            });
        } else {
            this._stack.push(null);
        }
    }

    private _useFlagToSymbolKind(flag: NonTerminalFlag) {
        switch (flag) {
            case NonTerminalFlag.UseClass:
                return SymbolKind.Class;
            case NonTerminalFlag.UseConstant:
                return SymbolKind.Constant;
            case NonTerminalFlag.UseFunction:
                return SymbolKind.Function;
            default:
                return 0;
        }
    }

}

export class NamespaceReader implements TreeVisitor<NonTerminal | Token> {

    private _stack: any[];

    constructor(public nameResolver: NameResolver) {
        this._stack = [];
    }

    inOrder(node:Tree<NonTerminal|Token>, afterChildIndex) {
        if (node.value && (<NonTerminal>node.value).nonTerminalType === NonTerminalType.Namespace && afterChildIndex === 0) {
            let ns = util.top(this._stack);
            if (ns) {
                this.nameResolver.pushNamespace(ns);
            }
        }
    }

    postOrder(node:Tree<NonTerminal|Token>) {

        if (!node.value) {
            this._stack.push(null);
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.NamespaceName:
                this._stack.push(util.popMany(this._stack, node.children.length).join('\\'));
                break;
            case NonTerminalType.Namespace:
                let name: string, list: boolean;
                [name, list] = util.popMany(this._stack, 2);
                if (name && list) {
                    this.nameResolver.popNamespace();
                }
                break;
            case NonTerminalType.TopStatementList:
                this._stack.push(true);
                break;
            case undefined:
                //Token
                this._stack.push((<Token>node.value).text);
            default:
                break;

        }

    }

    shouldDescend(node:Tree<NonTerminal|Token>) {

        if (!node) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.TopStatementList:
            case NonTerminalType.Namespace:
            case NonTerminalType.NamespaceName:
                return true;
            default:
                return false;
        }
    }

}

export class SymbolReader implements TreeVisitor<NonTerminal | Token> {

    private _stack: any[];

    constructor(public uri: string, public importTable: ImportTable,
        public nameResolver: NameResolver, public docBlockParser: PhpDocParser) {
        this._stack = [];
    }

    get symbols(){
        return this._stack;
    }

    postOrder(node:Tree<NonTerminal|Token>) {

        if (!node.value) {
            this._stack.push(null);
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.NamespaceName:
                this._stack.push(util.popMany(this._stack, node.children.length).join('\\'));
                break;
            case NonTerminalType.Namespace:
                this._postOrderNamespace(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.FunctionDeclaration:
                this._postOrderFunctionDeclaration(<Tree<NonTerminal>>node);
                break;
                case NonTerminalType.ConstantDeclaration:
                break;
            case NonTerminalType.ConstantDeclarationList:
            case NonTerminalType.InnerStatementList:
            case NonTerminalType.TopStatementList:
            case NonTerminalType.ClassStatementList:
                this._postOrderConsolidateList(<Tree<NonTerminal>>node);
                break;
            case undefined:
                //Token
                this._stack.push((<Token>node.value).text);
            default:
                util.popMany(this._stack, node.children.length);
                this._stack.push(null);
                break;
        }

    }

    shouldDescend(node:Tree<NonTerminal|Token>) {

        if (!node.value) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.UseStatement:
            case NonTerminalType.UseGroup:
            case NonTerminalType.HaltCompiler:
                return false;
            default:
                return true;
        }
    }

    private _postOrderConstantDeclaration(node:Tree<NonTerminal>){

        let name:string, value:string;
        [name, value] = util.popMany(this._stack, 2);
        if(!name){
            this._stack.push(null);
        }
        name = this.nameResolver.resolveRelative(name);
        let s = new Symbol(SymbolKind.Constant, name);
        s.start = node.value.startToken.range.start.line;
        s.end = node.value.startToken.range.end.line;
        this._stack.push(new Tree<Symbol>(s));

    }

    private _postOrderConsolidateList(node:Tree<NonTerminal>){
        
    }

    private _postOrderFunctionDeclaration(node: Tree<NonTerminal>) {

        let name: string, params: Tree<Symbol>[], returnType: string, body: Tree<Symbol>[];
        [name, params, returnType, body] = util.popMany(this._stack, 4);

        if (!name) {
            this._stack.push(null);
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new Symbol(SymbolKind.Function, this.nameResolver.resolveRelative(name));
        s.uri = this.uri;

        if (returnType) {
            s.type = returnType;
        }

        let tree = new Tree<Symbol>(s);
        tree.addChildren(params);

        for (let n = 0; n < params.length; ++n) {
            params[n].value.scope = name;
        }

        let doc = node.value.doc ? this.docBlockParser.parse(node.value.doc.text) : null;

        if (doc) {
            this._assignPhpDocToCallableSymbol(s, params, doc);
        }

        this._stack.push(tree);

    }

    private _assignPhpDocToCallableSymbol(s: Symbol, params: Tree<Symbol>[], doc: PhpDoc) {

        s.description = doc.summary;
        let tag: TypeTag;
        let paramMap: { [name: string]: Symbol } = {};
        let param: Symbol;

        for (let n = 0; n < params.length; ++n) {
            param = params[n].value;
            paramMap[param.name] = param;
        }

        for (let n = 0; n < doc.tags.length; ++n) {
            tag = doc.tags[n] as TypeTag;
            if (tag.tagName === '@param') {
                param = paramMap[tag.name];
                if (paramMap[tag.name]) {
                    param.description = tag.description;

                    param.type = PhpDocTypeString.concat(param.type, tag.typeString);
                }
            } else if (tag.tagName === '@return') {
                s.type = PhpDocTypeString.concat(s.type, tag.typeString);
            }
        }

    }

    private _postOrderNamespace(node: Tree<NonTerminal>) {
        let name: string, list: Tree<Symbol>[];
        [name, list] = util.popMany(this._stack, 2);
        let nodes: Tree<Symbol>[] = [];

        if (name) {
            let s = new Symbol(SymbolKind.Namespace, name);
            s.start = s.end = node.value.startToken.range.start.line;
            nodes.push(new Tree<Symbol>(s));
        }

        if (list) {
            Array.prototype.push.apply(nodes, list);
        }

        this._stack.push(nodes);
    }


}


