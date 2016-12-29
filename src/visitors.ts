/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { NonTerminal, NonTerminalType, NonTerminalFlag, Token, TokenType } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag, MethodTag } from './parse';
import * as util from './util';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString, SymbolModifier,
    SymbolTree, ResolvedVariableTable, SymbolStore
} from './symbol';


function namespaceNameToString(node: Tree<NonTerminal | Token>) {

    if (!node.children) {
        return null;
    }

    let parts: string[] = [];
    let child: Tree<Token>;
    for (let n = 0; n < node.children.length; ++n) {
        child = node.children[n] as Tree<Token>;
        if (child.value !== null) {
            parts.push(child.value.text);
        }
    }
    return parts.join('\\');
}

function nameToFqnString(nameNode: Tree<NonTerminal | Token>, nameResolver: NameResolver, kind: SymbolKind) {

    if (nameNode.value === null || !nameNode.children) {
        return null;
    }

    let namespaceName = namespaceNameToString(nameNode.children[0]);

    switch ((<NonTerminal>nameNode.value).flag) {
        case NonTerminalFlag.NameRelative:
            return nameResolver.resolveRelative(namespaceName);
        case NonTerminalFlag.NameNotFullyQualified:
            return nameResolver.resolveNotFullyQualified(namespaceName, kind);
        default:
            //fqn
            return namespaceName;
    }
}

function variableToString(variableNode: Tree<NonTerminal | Token>) {
    let child = variableNode.children[0] as Tree<Token>;

    if (child.value === null || child.value.tokenType !== TokenType.T_VARIABLE) {
        return null;
    }

    return child.value.text;
}

export class ImportRuleReader implements TreeVisitor<NonTerminal | Token> {

    private _prefix: string;
    private _kind: SymbolKind;

    constructor(public importTable: ImportTable) {

    }

    preOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.UseStatement:
                this._useStatement(node);
                return true;
            case NonTerminalType.UseGroup:
                this._useGroup(node);
                return true;
            case NonTerminalType.Namespace:
            case NonTerminalType.TopStatementList:
            case NonTerminalType.UseList:
                return true;
            case NonTerminalType.UseElement:
                this._useElement(node);
                return false;
            default:
                return false;
        }

    }

    private _useGroup(node: Tree<NonTerminal | Token>) {
        this._prefix = namespaceNameToString(node.children[0]);
        this._kind = this._useFlagToSymbolKind((<NonTerminal>node.value).flag);
    }

    private _useStatement(node: Tree<NonTerminal | Token>) {
        this._prefix = '';
        this._kind = this._useFlagToSymbolKind((<NonTerminal>node.value).flag);
    }

    private _useElement(node: Tree<NonTerminal | Token>) {

        let rule = {
            fqn: namespaceNameToString(node.children[0]),
            alias: node.children[1].value ? (<Token>node.children[1].value).text : null,
            kind: this._useFlagToSymbolKind((<NonTerminal>node.value).flag)
        }

        if (!rule.fqn) {
            return;
        }

        if (this._prefix) {
            rule.fqn = this._prefix + '\\' + rule.fqn;
        }

        if (this._kind) {
            rule.kind = this._kind;
        }

        this.importTable.addRule(rule);

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

    constructor(public nameResolver: NameResolver) {

    }

    preOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.TopStatementList:
                return true;
            case NonTerminalType.Namespace:
                this.nameResolver.namespace = namespaceNameToString(node.children[0]);
                return true;
            default:
                return false;
        }

    }

}

export class SymbolReader implements TreeVisitor<NonTerminal | Token> {

    private _tree: Tree<PhpSymbol>;
    private _doc: PhpDoc;
    private _modifiers: SymbolModifier;
    private _kind: SymbolKind;

    constructor(public uri: string, public importTable: ImportTable,
        public nameResolver: NameResolver, public docBlockParser: PhpDocParser,
        public symbolTreeRoot: SymbolTree) {
    }

    preOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.Namespace:
                this._namespace(node);
                return true;
            case NonTerminalType.FunctionDeclaration:
                this._functionOrMethodDeclaration(node, SymbolKind.Function);
                return true;
            case NonTerminalType.MethodDeclaration:
                this._functionOrMethodDeclaration(node, SymbolKind.Method);
                return true;
            case NonTerminalType.ClassDeclaration:
                this._classDeclaration(node);
                return true;
            case NonTerminalType.TraitDeclaration:
                this._traitDeclaration(node);
                return true;
            case NonTerminalType.InterfaceDeclaration:
                this._interfaceDeclaration(node);
                return true;
            case NonTerminalType.PropertyDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Property);
                return true;
            case NonTerminalType.ClassConstantDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Constant);
                return true;
            case NonTerminalType.ConstantDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Constant);
                return true;
            case NonTerminalType.ConstantDeclaration:
                this._propertyOrConstantDeclaration(node);
                return true;
            case NonTerminalType.UseTrait:
                this._useTrait(node);
                return true;
            case NonTerminalType.AnonymousClassDeclaration:

                return true;
            case NonTerminalType.Closure:

                return true;
            case NonTerminalType.ClosureUseVariable:

                return true;
            default:
                return true;
        }

    }



    postOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {

            case NonTerminalType.Namespace:
                if (this._tree.parent) {
                    this._tree = this._tree.parent;
                }
                break;
            case NonTerminalType.FunctionDeclaration:
            case NonTerminalType.ClassDeclaration:
            case NonTerminalType.TraitDeclaration:
            case NonTerminalType.InterfaceDeclaration:
            case NonTerminalType.PropertyDeclaration:
            case NonTerminalType.ClassConstantDeclaration:
            case NonTerminalType.ConstantDeclaration:
            case NonTerminalType.MethodDeclaration:

            case NonTerminalType.UseTrait:
                this._useTrait(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.Parameter:
                this._parameter(<Tree<NonTerminal>>node);
                break;
            case NonTerminalType.ParameterList:
                this._stack.push(util.popMany(this._stack, node.children.length));
                break;
            case NonTerminalType.TypeExpression:
                //stack top should be string
                break;
            case undefined:
                //Token
                this._stack.push((<Token>node.value).text);
            default:
                this._stack.push(null);
                break;
        }

    }

    private _namespace(node: Tree<NonTerminal | Token>) {

        let name = namespaceNameToString(node.children[0]);
        this.nameResolver.namespace = name;
        if (!name) {
            return;
        }

        this._tree.addChild(new Tree<PhpSymbol>(new PhpSymbol(SymbolKind.Namespace, name)));

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

    private _useTrait(node: Tree<NonTerminal | Token>) {

        let nameList = this._nameList(node.children[0]);
        Array.prototype.push.apply(this._tree.value.associated, nameList);

        //todo trait adaptations
    }

    private _parameter(node: Tree<NonTerminal | Token>) {

        let name = node.children[1].value !== null ?
            (<Token>node.children[1].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(SymbolKind.Parameter, name);
        let t = new Tree<PhpSymbol>(s);
        s.modifiers = this._nonTerminalFlagToSymbolModifier((<NonTerminal>node.value).flag);
        s.type = this._typeExpression(node.children[0]);
        this._tree.addChild(t);
        this._tree = t;
        this._assignLocation(s, <NonTerminal>node.value);

        if (this._doc) {

            let tag = this._doc.tags.find((v, i, a) => {
                return v.tagName === '@param' && v.name === name;
            }) as TypeTag;

            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString);
            }

        }

    }

    private _interfaceDeclaration(node: Tree<NonTerminal | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(SymbolKind.Interface, this.nameResolver.resolveRelative(name));
        let t = new Tree<PhpSymbol>(s);

        this._assignLocation(s, <NonTerminal>node.value);
        this._assignClassPhpDoc(t, (<NonTerminal>node.value).doc);
        this._tree.addChild(t);
        this._tree = t;
    }

    private _traitDeclaration(node: Tree<NonTerminal | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(SymbolKind.Trait, this.nameResolver.resolveRelative(name));
        let t = new Tree<PhpSymbol>(s);

        this._assignLocation(s, <NonTerminal>node.value);
        this._assignClassPhpDoc(t, (<NonTerminal>node.value).doc);
        this._tree.addChild(t);
        this._tree = t;

    }

    private _propertyOrConstantDeclaration(node: Tree<NonTerminal | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(this._kind, name);
        let t = new Tree<PhpSymbol>(s);
        s.modifiers = this._modifiers;

        if (this._doc) {

            s.description = this._doc.summary;
            let predicate = (v, i, a) => {
                return v.tagName === '@var' && (v.name === name || !v.name);
            };
            let tag = this._doc.tags.find(predicate) as TypeTag;

            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString);
            }

        }

        this._tree.addChild(t);
        this._tree = t;

    }

    private _propertyOrConstantDeclarationStatement(node: Tree<NonTerminal | Token>, kind: SymbolKind) {

        this._kind = kind;
        this._modifiers = this._nonTerminalFlagToSymbolModifier((<NonTerminal>node.value).flag);
        this._doc = (<NonTerminal>node.value).doc ?
            this.docBlockParser.parse((<NonTerminal>node.value).doc.text) : null;

    }

    private _assignPropertyPhpDoc(s: PhpSymbol, doc: PhpDoc) {
        if (!doc) {
            return;
        }

        let tag: TypeTag;
        for (let n = 0; n < doc.tags.length; ++n) {
            tag = doc.tags[n] as TypeTag;
            if (tag.tagName === '@var' && (!tag.name || tag.name === s.name)) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString);
                break;
            }
        }

    }

    private _assignLocation(s: PhpSymbol, n: NonTerminal) {
        s.start = n.startToken.range.start.line;
        s.end = n.startToken.range.end.line;
        s.uri = this.uri;
    }

    private _assignClassBody(t: Tree<PhpSymbol>, body: (Tree<PhpSymbol> | Tree<PhpSymbol>[] | string[])[]) {

        if (!body) {
            return;
        }
        let child: Tree<PhpSymbol> | Tree<PhpSymbol>[] | string[];
        let gChild: Tree<PhpSymbol> | string;

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
                        (<Tree<PhpSymbol>>gChild).value.scope = t.value.name;
                        t.addChild(<Tree<PhpSymbol>>gChild);
                    }
                }

            }
            else {
                //methods
                (<Tree<PhpSymbol>>child).value.scope = t.value.name;
                t.addChild(<Tree<PhpSymbol>>child);
            }
        }
    }

    private _assignClassPhpDoc(t: Tree<PhpSymbol>, doc: Token) {

        let phpDoc = doc ? this.docBlockParser.parse(doc.text) : null;
        if (!phpDoc) {
            return;
        }

        t.value.description = phpDoc.summary;
        this._addClassMagicMembers(t, phpDoc);

    }

    private _functionOrMethodDeclaration(node: Tree<NonTerminal | Token>, kind: SymbolKind) {

        let name = node.children[0].value ? (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new PhpSymbol(kind, name);
        s.modifiers = this._nonTerminalFlagToSymbolModifier((<NonTerminal>node.value).flag);
        s.type = this._typeExpression(node.children[2]);
        let t = new Tree<PhpSymbol>(s);
        this._doc = (<NonTerminal>node.value).doc ?
            this.docBlockParser.parse((<NonTerminal>node.value).doc.text) : null;

        if (this._doc) {
            s.description = this._doc.summary;
            let returnTag = this._doc.tags.find((v, i, a) => { return v.tagName === '@return' });
            if (returnTag) {
                s.type = s.type ?
                    s.type.merge((<TypeTag>returnTag).typeString) :
                    new TypeString((<TypeTag>returnTag).typeString);
            }
        }

        this._assignLocation(s, <NonTerminal>node.value);
        this._tree.addChild(t);
        this._tree = t;

    }

    private _typeExpression(node: Tree<NonTerminal | Token>) {

        if (!node.value) {
            return null;
        }

        let type: TypeString;

        if (node.children[0].value === null) {
            return null;
        } else if ((<NonTerminal>node.children[0].value).nonTerminalType === NonTerminalType.Name) {
            let name = nameToFqnString(node.children[0], this.nameResolver, SymbolKind.Class);
            if (!name) {
                return null;
            }
            return new TypeString(name);
        } else {
            //Token
            return new TypeString((<Token>node.children[0].value).text);
        }

    }

    private _nameList(node: Tree<NonTerminal | Token>) {

        if (!node.children) {
            return [];
        }

        let name: string;
        let names: string[] = [];
        for (let n = 0; n < node.children.length; ++n) {
            name = nameToFqnString(node.children[n], this.nameResolver, SymbolKind.Class);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }

    private _classDeclaration(node: Tree<NonTerminal | Token>) {

        let name = node.children[0].value !== null ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new PhpSymbol(SymbolKind.Class, name);
        let t = new Tree<PhpSymbol>(s);
        s.associated = [];

        //extends
        if (node.children[1].value) {
            let baseClassName = nameToFqnString(node.children[1], this.nameResolver, SymbolKind.Class);
            if (baseClassName) {
                s.associated.push(baseClassName);
            }
        }

        //implements
        if (node.children[2].value) {
            let implementsNameList = this._nameList(node.children[2]);
            if (implementsNameList.length) {
                Array.prototype.push.apply(s.associated, implementsNameList);
            }
        }

        s.modifiers = this._nonTerminalFlagToSymbolModifier((<NonTerminal>node.value).flag);

        this._assignClassPhpDoc(t, (<NonTerminal>node.value).doc);
        this._assignLocation(s, <NonTerminal>node.value);
        this._tree.addChild(t);
        this._tree = t;

    }

    private _addClassMagicMembers(classNode: Tree<PhpSymbol>, doc: PhpDoc) {

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

        if((flag & NonTerminalFlag.PassByRef) === NonTerminalFlag.PassByRef){
            symbolModifier |= SymbolModifier.Reference;
        }

        if((flag & NonTerminalFlag.Variadic) === NonTerminalFlag.Variadic){
            symbolModifier |= SymbolModifier.Variadic;
        }

        return symbolModifier;
    }

    private _propertyTagToTreeSymbol(tag: TypeTag): Tree<PhpSymbol> {

        let modifiers = SymbolModifier.Public | SymbolModifier.Magic;
        if (tag.tagName === '@property-write') {
            modifiers |= SymbolModifier.WriteOnly;
        } else if (tag.tagName === '@property-read') {
            modifiers |= SymbolModifier.ReadOnly;
        }

        let s = new PhpSymbol(SymbolKind.Property, tag.name);
        s.description = tag.description;
        s.modifiers = modifiers;
        s.type = new TypeString(tag.typeString);
        return new Tree<PhpSymbol>(s);
    }

    private _methodTagToTreeSymbol(tag: MethodTag): Tree<PhpSymbol> {
        let s = new PhpSymbol(SymbolKind.Method, tag.name);
        s.modifiers = SymbolModifier.Public | SymbolModifier.Magic;
        s.description = tag.description;
        s.type = new TypeString(tag.returnTypeString);
        let t = new Tree<PhpSymbol>(s);

        for (let n = 0; n < tag.parameters.length; ++n) {
            t.addChild(this._methodTagParamToSymbol(tag.parameters[n]));
        }

        return t;
    }

    private _methodTagParamToSymbol(methodTagParam: MethodTagParam): Tree<PhpSymbol> {

        let s = new PhpSymbol(SymbolKind.Parameter, methodTagParam.name);
        s.type = new TypeString(methodTagParam.typeString);
        return new Tree<PhpSymbol>(s);

    }

}

export class SymbolAtLineSearch implements TreeVisitor<PhpSymbol> {

    private _node: Tree<PhpSymbol>;
    private _line: number;
    private _kindMask: SymbolKind;

    constructor(line: number, kindMask: SymbolKind) {
        this._line = line;
        this._kindMask = kindMask;
    }

    get node() {
        return this._node;
    }

    preOrder(node: Tree<PhpSymbol>) {

        if (node.value !== null &&
            node.value.start >= this._line &&
            node.value.end <= this._line &&
            (node.value.kind & this._kindMask) > 0) {
            this._node = node;
            return true;
        }
        return false;

    }

}

export class NonTerminalAtPositionSearch implements TreeVisitor<NonTerminal | Token>{

    private _node: Tree<NonTerminal>;
    private _position: Position;

    constructor(position: Position) {
        this._position = position;
    }

    get node() {
        return this._node;
    }

    preOrder(node: Tree<NonTerminal | Token>) {

        if (node.value !== null && node.value.hasOwnProperty('nonTerminalType') &&
            util.isInRange(this._position,
                (<NonTerminal>node.value).startToken.range.start,
                (<NonTerminal>node.value).endToken.range.end)) {
            this._node = <Tree<NonTerminal>>node;
            return true;
        }
        return false;

    }

}

/**
 * Resolves variable type within a single scope
 */
export class VariableTypeResolver implements TreeVisitor<NonTerminal | Token>{

    constructor(public variableTable: ResolvedVariableTable,
        public nameResolver: NameResolver,
        public typeResolver: TypeResolver,
        public typeAssigner: TypeAssigner) {

    }

    preOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return false;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.FunctionDeclaration:
            case NonTerminalType.MethodDeclaration:
            case NonTerminalType.ClassDeclaration:
            case NonTerminalType.TraitDeclaration:
            case NonTerminalType.InterfaceDeclaration:
            case NonTerminalType.AnonymousClassDeclaration:
            case NonTerminalType.Closure:
                return false;
            case NonTerminalType.IfList:
            case NonTerminalType.Switch:
                this.variableTable.pushBranchGroup();
                return true;
            case NonTerminalType.If:
            case NonTerminalType.Case:
                this.variableTable.pushBranch();
                return true;
            case NonTerminalType.BinaryExpression:
                if ((<NonTerminal>node.value).flag === NonTerminalFlag.BinaryAssign ||
                    (<NonTerminal>node.value).flag === NonTerminalFlag.BinaryInstanceOf) {
                    this._binaryExpression(node);
                    return false;
                }
                return true;
            case NonTerminalType.Foreach:
                this._foreach(node);
                return false;
            default:
                return true;
        }

    }

    postOrder(node: Tree<NonTerminal | Token>) {

        if (node.value === null) {
            return;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.IfList:
            case NonTerminalType.Switch:
                this.variableTable.popBranchGroup();
                break;
            case NonTerminalType.If:
            case NonTerminalType.Case:
                this.variableTable.popBranch();
                break;
            default:
                break;
        }

    }

    private _binaryExpression(node: Tree<NonTerminal | Token>) {

        let lhs = node.children[0];
        let rhs = node.children[1];

        if (lhs.value === null ||
            ((<NonTerminal>lhs.value).nonTerminalType !== NonTerminalType.Variable &&
                (<NonTerminal>lhs.value).nonTerminalType !== NonTerminalType.Array &&
                (<NonTerminal>lhs.value).nonTerminalType !== NonTerminalType.Dimension) ||
            rhs.value === null) {
            return;
        }

        let type = this.typeResolver.resolveType(rhs);
        if (!type || type.isEmpty()) {
            return;
        }
        this.typeAssigner.assignType(lhs, type);

    }

    private _foreach(node: Tree<NonTerminal | Token>) {

        let expr1 = node.children[0];
        let expr3 = node.children[2];

        if (expr3.value === null ||
            ((<NonTerminal>expr3.value).nonTerminalType !== NonTerminalType.Variable &&
                (<NonTerminal>expr3.value).nonTerminalType !== NonTerminalType.Array &&
                (<NonTerminal>expr3.value).nonTerminalType !== NonTerminalType.Dimension) ||
            expr1.value === null) {
            return;
        }

        let type = this.typeResolver.resolveType(expr1);
        if (!type || type.isEmpty()) {
            return;
        }
        this.typeAssigner.assignType(expr3, type);

    }

}

export class TypeAssigner {

    private _table: ResolvedVariableTable;

    constructor(table: ResolvedVariableTable) {
        this._table = table;
    }

    assignType(node: Tree<NonTerminal | Token>, typeString: TypeString) {

        if (node.value === null) {
            return;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {
            case NonTerminalType.Array:
                this._array(node, typeString);
            case NonTerminalType.ArrayPair:
                this._arrayPair(node.children[1], typeString);
                break;
            case NonTerminalType.Dimension:
                this._dimension(node, typeString);
                break;
            case NonTerminalType.Variable:
                this._variable(node, typeString);
                break;
            default:
                break;
        }

    }

    private _dimension(node: Tree<NonTerminal | Token>, typeString: TypeString) {
        this.assignType(node.children[0], typeString.array());
    }

    private _array(node: Tree<NonTerminal | Token>, typeString: TypeString) {
        let type = typeString.arrayDereference();

        if (!node.children) {
            return;
        }

        for (let n = 0; n < node.children.length; ++n) {
            this._arrayPair(node.children[n], type);
        }
    }

    private _arrayPair(node: Tree<NonTerminal | Token>, typeString: TypeString) {
        this.assignType(node.children[1], typeString);
    }

    private _variable(node: Tree<NonTerminal | Token>, typeString: TypeString) {

        if (node.children && node.children.length &&
            (<Token>node.children[0].value).tokenType === TokenType.T_VARIABLE &&
            typeString &&
            !typeString.isEmpty()) {
            this._table.setVariable((<Token>node.children[0].value).text, typeString);
        }

    }


}

export class TypeResolver {

    constructor(public nameResolver: NameResolver,
        public variableTable: ResolvedVariableTable,
        public symbolStore: SymbolStore) {

    }

    resolveType(node: Tree<NonTerminal | Token>): TypeString {

        if (node.value === null) {
            return null;
        }

        switch ((<NonTerminal>node.value).nonTerminalType) {

            case NonTerminalType.Variable:
                return this._variable(node);
            case NonTerminalType.Dimension:
                return this._dimension(node);
            case NonTerminalType.StaticProperty:
            case NonTerminalType.Property:
                return this._property(node);
            case NonTerminalType.StaticMethodCall:
            case NonTerminalType.MethodCall:
                return this._methodCall(node);
            case NonTerminalType.Call:
                return this._call(node);
            case NonTerminalType.Name:
                return this._name(node);
            default:
                return null;
        }


    }

    private _dimension(node: Tree<NonTerminal | Token>) {

        let typeString = this.resolveType(node.children[0]);
        return typeString ? typeString.arrayDereference() : null;

    }

    private _call(node: Tree<NonTerminal | Token>) {

        let nameNode = node.children[0];

        if ((<NonTerminal>nameNode.value).nonTerminalType !== NonTerminalType.Name) {
            return null;
        }

        let name = nameToFqnString(nameNode, this.nameResolver, SymbolKind.Function);
        if (!name) {
            return null;
        }

        let functionSymbol = this.symbolStore.match(name, SymbolKind.Function).shift();
        return functionSymbol ? functionSymbol.value.type : null;

    }

    private _methodCall(node: Tree<NonTerminal | Token>) {

        let methodNameToken = node.children[1].value as Token;
        if (!methodNameToken) {
            return null;
        }

        let classTypeString = this.resolveType(node);
        if (!classTypeString) {
            return null;
        }

        let methodSymbol = this._lookupMemberSymbol(
            this._lookupTypeSymbols(classTypeString),
            methodNameToken.text,
            SymbolKind.Method
        );

        return methodSymbol ? methodSymbol.value.type : null;

    }

    private _property(node: Tree<NonTerminal | Token>) {

        let propName = variableToString(node.children[1]);
        if (!propName) {
            return null;
        }

        let classTypeString = this.resolveType(node);
        if (!classTypeString) {
            return null;
        }

        let propSymbol = this._lookupMemberSymbol(
            this._lookupTypeSymbols(classTypeString),
            propName,
            SymbolKind.Property
        );

        return propSymbol ? propSymbol.value.type : null;
    }

    private _variable(node: Tree<NonTerminal | Token>) {

        let child = node.children[0] as Tree<Token>;

        if (child.value === null || child.value.tokenType !== TokenType.T_VARIABLE) {
            return null;
        }

        return this.variableTable.getType(child.value.text);

    }

    private _name(node: Tree<NonTerminal | Token>) {
        let name = nameToFqnString(node, this.nameResolver, SymbolKind.Class);
        return name ? new TypeString(name) : null;
    }

    private _lookupTypeSymbols(typeString: TypeString) {

        let typeNameArray = typeString ? typeString.atomicClassArray() : [];
        let typeSymbols: Tree<PhpSymbol>[] = [];
        let typeSymbol: Tree<PhpSymbol>;
        let kindMask = SymbolKind.Class | SymbolKind.Trait;

        for (let n = 0; n < typeNameArray.length; ++n) {
            typeSymbol = this.symbolStore.match(typeNameArray[n], kindMask).shift();
            if (typeSymbol) {
                typeSymbols.push(typeSymbol);
            }
        }

        return typeSymbols;

    }

    private _lookupMemberSymbol(types: Tree<PhpSymbol>[], memberName: string, kind: SymbolKind): Tree<PhpSymbol> {

        let predicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return x.value.name === memberName &&
                x.value.kind === kind;
        };

        let type: Tree<PhpSymbol>;
        let member: Tree<PhpSymbol>;
        let associated = new Set<string>();

        for (let n = 0; n < types.length; ++n) {
            type = types[n];
            member = type.find(predicate);
            if (member) {
                return member;
            }

            if (type.value.associated) {
                Set.prototype.add.apply(associated, type.value.associated);
            }

        }

        //lookup in base class/traits
        if (associated.size) {
            return this._lookupMemberSymbol(
                this._lookupTypeSymbols(new TypeString(Array.from(associated).join('|'))),
                memberName,
                kind
            );
        }

        return null;

    }

}



