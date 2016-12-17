/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { NonTerminal, NonTerminalType, NonTerminalFlag, Token } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag, MethodTag } from './parse';
import * as util from './util';
import { Symbol, NameResolver, ImportRule, ImportTable, SymbolKind, PhpDocTypeString, SymbolModifier, SymbolTree } from './symbol';

export class ImportTableReader implements TreeVisitor<NonTerminal | Token> {

    private _stack: any[];

    constructor(public importTable: ImportTable) {
        this._stack = [];
    }

    postOrder(node: Tree<NonTerminal>) {

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

    inOrder(node: Tree<NonTerminal | Token>, afterChildIndex) {
        if (node.value && (<NonTerminal>node.value).nonTerminalType === NonTerminalType.Namespace && afterChildIndex === 0) {
            let ns = util.top(this._stack);
            if (ns) {
                this.nameResolver.pushNamespace(ns);
            }
        }
    }

    postOrder(node: Tree<NonTerminal | Token>) {

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

    shouldDescend(node: Tree<NonTerminal | Token>) {

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
        public nameResolver: NameResolver, public docBlockParser: PhpDocParser,
        public symbolTreeRoot: SymbolTree) {
        this._stack = [];
    }

    get symbols() {
        return this._stack;
    }

    postOrder(node: Tree<NonTerminal | Token>) {

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
            case NonTerminalType.Name:
                this._postOrderName(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.NameList:
                this._stack.push(this._filterNull(util.popMany(this._stack, node.children.length)));
                break;
            case NonTerminalType.FunctionDeclaration:
                this._postOrderFunctionDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.ClassDeclaration:
                this._postOrderClassDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.TraitDeclaration:
                this._postOrderTraitDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.InterfaceDeclaration:
                this._postOrderInterfaceDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.ClassConstantDeclarationList:
            case NonTerminalType.PropertyDeclarationList:
                this._postOrderPropertyOrClassConstantDeclarationStatement(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.PropertyDeclaration:
                this._postOrderPropertyOrClassConstantDeclaration(<Tree<NonTerminal>>node, SymbolKind.Property);
                break;
            case NonTerminalType.ClassConstantDeclaration:
                this._postOrderPropertyOrClassConstantDeclaration(<Tree<NonTerminal>>node, SymbolKind.Constant);
                break;
            case NonTerminalType.ConstantDeclaration:
                this._postOrderConstantDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.MethodDeclaration:
                this._postOrderMethodDeclaration(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.ClassStatementList:
                this._stack.push(util.popMany(this._stack, node.children.length));
                break;
            case NonTerminalType.UseTrait:
                this._postOrderUseTrait(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.Parameter:
                this._postOrderParameter(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.ParameterList:
                this._stack.push(util.popMany(this._stack, node.children.length));
                break;
            case NonTerminalType.TypeExpression:
                //stack top should be string
                break;
            case NonTerminalType.FunctionBody:
            case NonTerminalType.MethodBody:
            case NonTerminalType.TraitAdaptationList:
                //not descended but expected on stack
                this._stack.push(null);
            case undefined:
                //Token
                this._stack.push((<Token>node.value).text);
            default:
                this._stack.push(null);
                break;
        }

    }

    shouldDescend(node: Tree<NonTerminal | Token>) {

        if (!node.value) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.Block:
            case NonTerminalType.Case:
            case NonTerminalType.CaseList:
            case NonTerminalType.Catch:
            case NonTerminalType.CatchList:
            case NonTerminalType.ClassConstantDeclaration:
            case NonTerminalType.ClassConstantDeclarationList:
            case NonTerminalType.ClassDeclaration:
            case NonTerminalType.ClassStatementList:
            case NonTerminalType.ConstantDeclaration:
            case NonTerminalType.ConstantDeclarationList:
            case NonTerminalType.DoWhile:
            case NonTerminalType.Finally:
            case NonTerminalType.For:
            case NonTerminalType.Foreach:
            case NonTerminalType.FunctionDeclaration:
            case NonTerminalType.If:
            case NonTerminalType.IfList:
            case NonTerminalType.InnerStatementList:
            case NonTerminalType.InterfaceDeclaration:
            case NonTerminalType.MethodDeclaration:
            case NonTerminalType.Name:
            case NonTerminalType.NameList:
            case NonTerminalType.Namespace:
            case NonTerminalType.NamespaceName:
            case NonTerminalType.Parameter:
            case NonTerminalType.ParameterList:
            case NonTerminalType.PropertyDeclaration:
            case NonTerminalType.PropertyDeclarationList:
            case NonTerminalType.Switch:
            case NonTerminalType.TopStatementList:
            case NonTerminalType.TraitDeclaration:
            case NonTerminalType.Try:
            case NonTerminalType.TypeExpression:
            case NonTerminalType.UseTrait:
            case NonTerminalType.While:
                return true;
            default:
                return false;
        }
    }

    private _postOrderUseTrait(node:Tree<NonTerminal>){

        let nameList:string[], adaptationList:null;
        [nameList, adaptationList] = util.popMany(this._stack, 2);
        this._stack.push(nameList);

    }

    private _postOrderParameter(node: Tree<NonTerminal>) {

        let type: string, name: string, expr: null;
        [type, name, expr] = util.popMany(this._stack, 3);

        if (!name) {
            this._stack.push(null);
            return;
        }

        let s = new Symbol(SymbolKind.Parameter, name);
        s.type = type;
        this._assignLocation(s, node.value);
        this._stack.push(new Tree<Symbol>(s));

    }

    private _filterNull(array: any[]) {

        let filtered: any[] = [];
        for (let n = 0; n < array.length; ++n) {
            if (array[n] !== null) {
                filtered.push(array[n]);
            }
        }
        return filtered;
    }

    private _postOrderName(node: Tree<NonTerminal>) {
        let nsName = this._stack.pop() as string;

        if (!nsName) {
            this._stack.push(null);
            return;
        }

        switch (node.value.flag) {
            case NonTerminalFlag.NameFullyQualified:
                this._stack.push(nsName);
                break;
            case NonTerminalFlag.NameRelative:
                this._stack.push(this.nameResolver.resolveRelative(nsName));
                break;
            case NonTerminalFlag.NameNotFullyQualified:
                this._stack.push(this.nameResolver.resolveNotFullyQualified(nsName, SymbolKind.Class));
                break;
            default:
                break;
        }
    }

    private _postOrderInterfaceDeclaration(node: Tree<NonTerminal>) {

        let name: string, extendsList: string[], body: (Tree<Symbol>[] | Tree<Symbol> | string[])[];
        [name, extendsList, body] = util.popMany(this._stack, 3);
        if (!name) {
            return;
        }

        let s = new Symbol(SymbolKind.Interface, this.nameResolver.resolveRelative(name));
        let t = new Tree<Symbol>(s);
        this._assignLocation(s, node.value);
        this._assignClassBody(t, body);
        this._assignClassPhpDoc(t, node.value.doc);
        this.symbolTreeRoot.addChild(t);

    }

    private _postOrderTraitDeclaration(node: Tree<NonTerminal>) {

        let name: string, body: (Tree<Symbol>[] | Tree<Symbol> | string[])[];
        [name, body] = util.popMany(this._stack, 2);

        if (!name) {
            return;
        }

        let s = new Symbol(SymbolKind.Trait, this.nameResolver.resolveRelative(name));
        let t = new Tree<Symbol>(s);
        this._assignLocation(s, node.value);
        this._assignClassBody(t, body);
        this._assignClassPhpDoc(t, node.value.doc);
        this.symbolTreeRoot.addChild(t);

    }

    private _postOrderPropertyOrClassConstantDeclaration(node: Tree<NonTerminal>, kind: SymbolKind) {
        let name: string, value: string;
        [name, value] = util.popMany(this._stack, 2);

        if (!name) {
            this._stack.push(null);
            return;
        }

        let s = new Symbol(kind, name);
        this._assignLocation(s, node.value);
        this._stack.push(new Tree<Symbol>(s));
    }

    private _postOrderPropertyOrClassConstantDeclarationStatement(node: Tree<NonTerminal>) {

        let list = util.popMany(this._stack, node.children.length);
        let prop: Tree<Symbol>;
        let modifiers = this._nonTerminalFlagToSymbolModifier(node.value.flag);
        let doc = node.value.doc ? this.docBlockParser.parse(node.value.doc.text) : null;
        let filtered: Tree<Symbol>[] = [];

        for (let n = 0; n < list.length; ++n) {
            prop = list[n];
            if (!prop) {
                continue;
            }
            prop.value.modifiers = modifiers;
            this._assignPropertyPhpDoc(prop.value, doc);
            filtered.push(prop);
        }

        this._stack.push(filtered);

    }

    private _assignPropertyPhpDoc(s: Symbol, doc: PhpDoc) {
        if (!doc) {
            return;
        }

        let tag: TypeTag;
        for (let n = 0; n < doc.tags.length; ++n) {
            tag = doc.tags[n] as TypeTag;
            if (tag.tagName === '@var' && (!tag.name || tag.name === s.name)) {
                s.description = tag.description;
                s.type = tag.typeString;
                break;
            }
        }

    }

    private _postOrderConstantDeclaration(node: Tree<NonTerminal>) {

        let name: string, value: string;
        [name, value] = util.popMany(this._stack, 2);
        if (!name) {
            this._stack.push(null);
            return;
        }
        name = this.nameResolver.resolveRelative(name);
        let s = new Symbol(SymbolKind.Constant, name);
        this._assignLocation(s, node.value);
        this.symbolTreeRoot.addChild(new Tree<Symbol>(s));

    }

    private _assignLocation(s: Symbol, n: NonTerminal) {
        s.start = n.startToken.range.start.line;
        s.end = n.startToken.range.end.line;
        s.uri = this.uri;
    }

    private _assignClassBody(t: Tree<Symbol>, body: (Tree<Symbol> | Tree<Symbol>[] | string[])[]) {

        if (!body) {
            return;
        }
        let child: Tree<Symbol> | Tree<Symbol>[] | string[];
        let gChild: Tree<Symbol> | string;

        for (let n = 0; n < body.length; ++n) {
            child = body[n];

            if (Array.isArray(child)) {
                if (!child.length) {
                    continue;
                }

                if (util.isString(child[0])) {
                    //traits
                    if (!t.value.associated) {
                        t.value.associated = [];
                    }
                    Array.prototype.push.apply(t.value.associated, child);
                } else {
                    //constants, properties
                    for (let k = 0; k < child.length; ++k) {
                        gChild = child[k];
                        //property/constant
                        (<Tree<Symbol>>gChild).value.scope = t.value.name;
                        t.addChild(<Tree<Symbol>>gChild);
                    }
                }

            }
            else {
                //methods
                (<Tree<Symbol>>child).value.scope = t.value.name;
                t.addChild(<Tree<Symbol>>child);
            }
        }
    }

    private _assignClassPhpDoc(t: Tree<Symbol>, doc: Token) {
        if (!doc) {
            return;
        }

        let phpDoc = this.docBlockParser.parse(doc.text);
        t.value.description = phpDoc.summary;
        this._addClassMagicMembers(t, phpDoc);

    }

    private _postOrderMethodDeclaration(node: Tree<NonTerminal>) {

        let name: string, params: Tree<Symbol>[], returnType: string, body: null;
        [name, params, returnType, body] = util.popMany(this._stack, 4);

        if (!name) {
            this._stack.push(null);
            return;
        }

        let s = new Symbol(SymbolKind.Method, name);
        s.modifiers = this._nonTerminalFlagToSymbolModifier(node.value.flag);

        if (returnType) {
            s.type = returnType;
        }

        let tree = new Tree<Symbol>(s);
        this._assignFunctionOrMethodParameters(tree, params);
        this._assignFunctionOrMethodPhpDoc(s, params, node.value.doc);
        this._assignLocation(s, node.value);
        this._stack.push(tree);

    }

    private _postOrderFunctionDeclaration(node: Tree<NonTerminal>) {

        let name: string, params: Tree<Symbol>[], returnType: string, body: null;
        [name, params, returnType, body] = util.popMany(this._stack, 4);

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new Symbol(SymbolKind.Function, name);

        if (returnType) {
            s.type = returnType;
        }

        let tree = new Tree<Symbol>(s);
        this._assignFunctionOrMethodParameters(tree, params);
        this._assignFunctionOrMethodPhpDoc(s, params, node.value.doc);
        this._assignLocation(s, node.value);
        this.symbolTreeRoot.addChild(tree);

    }



    private _assignFunctionOrMethodParameters(s: Tree<Symbol>, params: Tree<Symbol>[]) {

        let param: Tree<Symbol>;
        for (let n = 0; n < params.length; ++n) {
            param = params[n];
            if (!param) {
                continue;
            }
            param.value.scope = s.value.name;
            s.addChild(param);
        }

    }

    private _assignFunctionOrMethodPhpDoc(s: Symbol, params: Tree<Symbol>[], doc: Token) {

        let phpDoc: PhpDoc;
        if (!doc || !(phpDoc = this.docBlockParser.parse(doc.text))) {
            return;
        }

        s.description = phpDoc.summary;
        let tag: TypeTag;
        let paramMap: { [name: string]: Symbol } = {};
        let param: Symbol;

        for (let n = 0; n < params.length; ++n) {
            param = params[n].value;
            paramMap[param.name] = param;
        }

        for (let n = 0; n < phpDoc.tags.length; ++n) {
            tag = phpDoc.tags[n] as TypeTag;
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
            s.uri = this.uri;
            this.symbolTreeRoot.addChild(new Tree<Symbol>(s));
        }

    }

    private _postOrderClassDeclaration(node: Tree<NonTerminal>) {

        let name: string, extendsClass: string, implementsInterfaces: string[], body: (string[] | Tree<Symbol>)[];
        [name, extendsClass, implementsInterfaces, body] = util.popMany(this._stack, 4);

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new Symbol(SymbolKind.Class, name);
        if (extendsClass || (implementsInterfaces && implementsInterfaces.length)) {
            s.associated = [];
            if (extendsClass) {
                s.associated.push(extendsClass);
            }
            if (implementsInterfaces) {
                Array.prototype.push.apply(s.associated, implementsInterfaces);
            }
        }

        s.modifiers = this._nonTerminalFlagToSymbolModifier(node.value.flag);
        let t = new Tree<Symbol>(s);
        this._assignClassBody(t, body);
        this._assignClassPhpDoc(t, node.value.doc);
        this._assignLocation(s, node.value);
        this.symbolTreeRoot.addChild(t);

    }

    private _addClassMagicMembers(classNode: Tree<Symbol>, doc: PhpDoc) {

        let tag: Tag;
        for (let n = 0; n < doc.tags.length; ++n) {
            tag = doc.tags[n];
            if (tag.tagName.indexOf('@property') !== -1) {
                classNode.addChild(this._propertyTagToTreeSymbol(<TypeTag>tag));
            } else if (tag.tagName === '@method') {
                classNode.addChild(this._methodTagToTreeSymbol(<MethodTag>tag));
            }
        }

    }

    private _nonTerminalFlagToSymbolModifier(flag: NonTerminalFlag) {

        let symbolModifier = 0;
        if ((flag & NonTerminalFlag.ModifierFinal) === NonTerminalFlag.ModifierFinal) {
            symbolModifier = SymbolModifier.Final;
        }

        if ((flag & NonTerminalFlag.ModifierAbstract) === NonTerminalFlag.ModifierAbstract) {
            symbolModifier |= SymbolModifier.Abstract;
        }

        if ((flag & NonTerminalFlag.ModifierPrivate) === NonTerminalFlag.ModifierPrivate) {
            symbolModifier |= SymbolModifier.Private;
        }

        if ((flag & NonTerminalFlag.ModifierProtected) === NonTerminalFlag.ModifierProtected) {
            symbolModifier |= SymbolModifier.Protected;
        }

        if ((flag & NonTerminalFlag.ModifierPublic) === NonTerminalFlag.ModifierPublic) {
            symbolModifier |= SymbolModifier.Public;
        }

        if ((flag & NonTerminalFlag.ModifierStatic) === NonTerminalFlag.ModifierStatic) {
            symbolModifier |= SymbolModifier.Static;
        }

        return symbolModifier;
    }

    private _propertyTagToTreeSymbol(tag: TypeTag): Tree<Symbol> {

        let modifiers = SymbolModifier.Public | SymbolModifier.Magic;
        if (tag.tagName === '@property-write') {
            modifiers |= SymbolModifier.WriteOnly;
        } else if (tag.tagName === '@property-read') {
            modifiers |= SymbolModifier.ReadOnly;
        }

        let s = new Symbol(SymbolKind.Property, tag.name);
        s.description = tag.description;
        s.modifiers = modifiers;
        s.type = tag.typeString;
        return new Tree<Symbol>(s);
    }

    private _methodTagToTreeSymbol(tag: MethodTag): Tree<Symbol> {
        let s = new Symbol(SymbolKind.Method, tag.name);
        s.modifiers = SymbolModifier.Public | SymbolModifier.Magic;
        s.description = tag.description;
        s.type = tag.returnTypeString;
        let t = new Tree<Symbol>(s);

        for (let n = 0; n < tag.parameters.length; ++n) {
            t.addChild(this._methodTagParamToSymbol(tag.parameters[n]));
        }

        return t;
    }

    private _methodTagParamToSymbol(methodTagParam: MethodTagParam): Tree<Symbol> {

        let s = new Symbol(SymbolKind.Parameter, methodTagParam.name);
        s.type = methodTagParam.typeString;
        return new Tree<Symbol>(s);

    }


}


