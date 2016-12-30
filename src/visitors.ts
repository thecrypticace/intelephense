/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, BinarySearch, SuffixArray } from './types';
import { Phrase, PhraseType, PhraseFlag, Token, TokenType } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag, MethodTag, ParsedDocument } from './parse';
import * as util from './util';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString,
    SymbolModifier, SymbolTree, ResolvedVariableTable, SymbolStore, DocumentSymbols
} from './symbol';


function namespaceNameToString(node: Tree<Phrase | Token>) {

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

function nameToFqnString(nameNode: Tree<Phrase | Token>, nameResolver: NameResolver, kind: SymbolKind) {

    if (nameNode.value === null || !nameNode.children) {
        return null;
    }

    let namespaceName = namespaceNameToString(nameNode.children[0]);

    switch ((<Phrase>nameNode.value).flag) {
        case PhraseFlag.NameRelative:
            return nameResolver.resolveRelative(namespaceName);
        case PhraseFlag.NameNotFullyQualified:
            return nameResolver.resolveNotFullyQualified(namespaceName, kind);
        default:
            //fqn
            return namespaceName;
    }
}

function variableToString(variableNode: Tree<Phrase | Token>) {
    let child = variableNode.children[0] as Tree<Token>;

    if (child.value === null || child.value.tokenType !== TokenType.T_VARIABLE) {
        return null;
    }

    return child.value.text;
}

export class SymbolReader implements TreeVisitor<Phrase | Token> {

    private _doc: PhpDoc;
    private _modifiers: SymbolModifier;
    private _kind: SymbolKind;
    private _prefix: string;

    constructor(public uri: string, public importTable: ImportTable,
        public nameResolver: NameResolver, public docBlockParser: PhpDocParser,
        public tree: Tree<PhpSymbol>) {
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (node.value === null) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.UseStatement:
                this._useStatement(node);
                return true;
            case PhraseType.UseGroup:
                this._useGroup(node);
                return true;
            case PhraseType.UseElement:
                this._useElement(node);
                return false;
            case PhraseType.Namespace:
                this._namespace(node);
                return true;
            case PhraseType.FunctionDeclaration:
                this._functionOrMethodDeclaration(node, SymbolKind.Function);
                return true;
            case PhraseType.MethodDeclaration:
                this._functionOrMethodDeclaration(node, SymbolKind.Method);
                return true;
            case PhraseType.ClassDeclaration:
                this._classDeclaration(node);
                return true;
            case PhraseType.TraitDeclaration:
                this._traitDeclaration(node);
                return true;
            case PhraseType.InterfaceDeclaration:
                this._interfaceDeclaration(node);
                return true;
            case PhraseType.PropertyDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Property);
                return true;
            case PhraseType.ClassConstantDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Constant);
                return true;
            case PhraseType.ConstantDeclarationList:
                this._propertyOrConstantDeclarationStatement(node, SymbolKind.Constant);
                return true;
            case PhraseType.ConstantDeclaration:
                this._propertyOrConstantDeclaration(node);
                return false;
            case PhraseType.UseTrait:
                this._useTrait(node);
                return false;
            case PhraseType.TypeExpression:
                this._typeExpression(node);
                return false;
            case PhraseType.AnonymousClassDeclaration:
                this._classDeclaration(node, true);
                return true;
            case PhraseType.Closure:
                this._closure(node);
                return true;
            case PhraseType.ClosureUseVariable:
                this._closureUseVariable(node);
                return false;
            case undefined:
                //Token
                this._token(node);
                return false;
            case PhraseType.NameList:
                return false;
            default:
                return true;
        }

    }

    postOrder(node: Tree<Phrase | Token>) {

        if (node.value === null) {
            return;
        }

        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Namespace:
            case PhraseType.FunctionDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.PropertyDeclaration:
            case PhraseType.ClassConstantDeclaration:
            case PhraseType.ConstantDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.Parameter:
                this.tree = this.tree.parent;
                break;
            default:
                break;
        }

    }

    private _useGroup(node: Tree<Phrase | Token>) {
        this._prefix = namespaceNameToString(node.children[0]);
        this._kind = this._useFlagToSymbolKind((<Phrase>node.value).flag);
    }

    private _useStatement(node: Tree<Phrase | Token>) {
        this._prefix = '';
        this._kind = this._useFlagToSymbolKind((<Phrase>node.value).flag);
    }

    private _useElement(node: Tree<Phrase | Token>) {

        let rule = {
            fqn: namespaceNameToString(node.children[0]),
            alias: node.children[1].value ? (<Token>node.children[1].value).text : null,
            kind: this._useFlagToSymbolKind((<Phrase>node.value).flag)
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

    private _useFlagToSymbolKind(flag: PhraseFlag) {
        switch (flag) {
            case PhraseFlag.UseClass:
                return SymbolKind.Class;
            case PhraseFlag.UseConstant:
                return SymbolKind.Constant;
            case PhraseFlag.UseFunction:
                return SymbolKind.Function;
            default:
                return 0;
        }
    }

    private _token(node: Tree<Phrase | Token>) {

        if ((<Token>node.value).tokenType !== TokenType.T_VARIABLE) {
            return;
        }

        let name = (<Token>node.value).text;
        let existing = this.tree.children.find((v, i, a) => {
            return v.value.name === name;
        });

        if (existing) {
            return;
        }

        let s = new PhpSymbol(SymbolKind.Variable, name);
        s.start = s.end = (<Token>node.value).range.start.line;
        s.uri = this.uri;
        this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _namespace(node: Tree<Phrase | Token>) {

        let name = namespaceNameToString(node.children[0]);
        this.nameResolver.namespace = name;
        //empty name valid - global namespace
        let s = new PhpSymbol(SymbolKind.Namespace, name);
        s.start = s.end = (<Phrase>node.value).startToken.range.start.line;
        s.uri = this.uri;
        this.tree = this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _closure(node: Tree<Phrase | Token>) {

        //params, use, typeExpr, body

        let name = 'Closure:' + util.guid();
        let s = new PhpSymbol(SymbolKind.Function, name);
        s.modifiers = SymbolModifier.Anonymous;
        this._assignLocation(s, <Phrase>node.value);
        this.tree = this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _closureUseVariable(node: Tree<Phrase | Token>) {

        if (!node.children) {
            return;
        }

        let name = node.children[0].value ? (<Token>node.children[0].value).text : null;
        if (!name) {
            return;
        }
        let s = new PhpSymbol(SymbolKind.Variable, name);
        s.modifiers = this._nonTerminalFlagToSymbolModifier((<Phrase>node.value).flag);
        this._assignLocation(s, <Phrase>node.value);
        this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _useTrait(node: Tree<Phrase | Token>) {

        let nameList = this._nameList(node.children[0]);
        Array.prototype.push.apply(this.tree.value.associated, nameList);

        //todo trait adaptations
    }

    private _parameter(node: Tree<Phrase | Token>) {

        let name = node.children[1].value ?
            (<Token>node.children[1].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(SymbolKind.Parameter, name);
        let t = new Tree<PhpSymbol>(s);
        s.modifiers = this._nonTerminalFlagToSymbolModifier((<Phrase>node.value).flag);
        this._assignLocation(s, <Phrase>node.value);

        if (this._doc) {

            let tag = this._doc.tags.find((v, i, a) => {
                return v.tagName === '@param' && v.name === name;
            }) as TypeTag;

            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString);
            }

        }

        this.tree = this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _interfaceDeclaration(node: Tree<Phrase | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new PhpSymbol(SymbolKind.Interface, name);
        let t = new Tree<PhpSymbol>(s)

        s.associated = [];
        if (node.children[1].value) {
            let implementsNameList = this._nameList(node.children[1]);
            Array.prototype.push.apply(s.associated, implementsNameList);
        }

        this._assignLocation(s, <Phrase>node.value);
        this._assignClassPhpDoc(t, (<Phrase>node.value).doc);
        this.tree = this.tree.addChild(t);

    }

    private _traitDeclaration(node: Tree<Phrase | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new PhpSymbol(SymbolKind.Trait, name);
        let t = new Tree<PhpSymbol>(s);
        this._assignLocation(s, <Phrase>node.value);
        this._assignClassPhpDoc(t, (<Phrase>node.value).doc);
        this.tree = this.tree.addChild(t);

    }

    private _propertyOrConstantDeclaration(node: Tree<Phrase | Token>) {

        let name = node.children[0].value ?
            (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        let s = new PhpSymbol(this._kind, name);
        s.modifiers = this._modifiers;

        if (this._doc) {

            s.description = this._doc.summary;
            let tag = this._doc.tags.find((v, i, a) => {
                return v.tagName === '@var' && (v.name === name || !v.name);
            }) as TypeTag;

            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString);
            }

        }

        this.tree = this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _propertyOrConstantDeclarationStatement(node: Tree<Phrase | Token>, kind: SymbolKind) {

        this._kind = kind;
        this._modifiers = this._nonTerminalFlagToSymbolModifier((<Phrase>node.value).flag);
        this._doc = (<Phrase>node.value).doc ?
            this.docBlockParser.parse((<Phrase>node.value).doc.text) : null;

    }

    private _assignLocation(s: PhpSymbol, n: Phrase) {
        s.start = n.startToken.range.start.line;
        s.end = n.endToken.range.end.line;
        s.uri = this.uri;
    }

    private _assignClassPhpDoc(t: Tree<PhpSymbol>, doc: Token) {

        let phpDoc = doc ? this.docBlockParser.parse(doc.text) : null;
        if (!phpDoc) {
            return;
        }

        t.value.description = phpDoc.summary;
        this._addClassMagicMembers(t, phpDoc);

    }

    private _functionOrMethodDeclaration(node: Tree<Phrase | Token>, kind: SymbolKind) {

        let name = node.children[0].value ? (<Token>node.children[0].value).text : null;

        if (!name) {
            return;
        }

        name = this.nameResolver.resolveRelative(name);
        let s = new PhpSymbol(kind, name);
        s.modifiers = this._nonTerminalFlagToSymbolModifier((<Phrase>node.value).flag);
        this._doc = (<Phrase>node.value).doc ?
            this.docBlockParser.parse((<Phrase>node.value).doc.text) : null;

        if (this._doc) {
            s.description = this._doc.summary;
            let returnTag = this._doc.tags.find((v, i, a) => { return v.tagName === '@return' });
            if (returnTag) {
                s.type = s.type ?
                    s.type.merge((<TypeTag>returnTag).typeString) :
                    new TypeString((<TypeTag>returnTag).typeString);
            }
        }

        this._assignLocation(s, <Phrase>node.value);
        this.tree = this.tree.addChild(new Tree<PhpSymbol>(s));

    }

    private _typeExpression(node: Tree<Phrase | Token>) {

        if (!node.value) {
            return null;
        }

        let type: string;

        if (node.children[0].value === null) {
            return;
        } else if ((<Phrase>node.children[0].value).phraseType === PhraseType.Name) {
            type = nameToFqnString(node.children[0], this.nameResolver, SymbolKind.Class);
            if (!type) {
                return;
            }

        } else {
            //Token
            type = (<Token>node.children[0].value).text;
        }

        this.tree.value.type = this.tree.value.type ?
            this.tree.value.type.merge(type) : new TypeString(type);

    }

    private _nameList(node: Tree<Phrase | Token>) {

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

    private _classDeclaration(node: Tree<Phrase | Token>, isAnonymous = false) {

        let name: string;

        if (isAnonymous) {
            name = 'AnonymousClass:' + util.guid();
        } else {
            name = node.children[0].value !== null ?
                (<Token>node.children[0].value).text : null;

            if (!name) {
                return;
            }

            name = this.nameResolver.resolveRelative(name);
        }

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
            Array.prototype.push.apply(s.associated, implementsNameList);
        }

        s.modifiers = this._nonTerminalFlagToSymbolModifier((<Phrase>node.value).flag);

        this._assignClassPhpDoc(t, (<Phrase>node.value).doc);
        this._assignLocation(s, <Phrase>node.value);
        this.tree = this.tree.addChild(t);

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

    private _nonTerminalFlagToSymbolModifier(flag: PhraseFlag) {

        let symbolModifier = 0;
        if ((flag & PhraseFlag.ModifierFinal) > 0) {
            symbolModifier = SymbolModifier.Final;
        }

        if ((flag & PhraseFlag.ModifierAbstract) > 0) {
            symbolModifier |= SymbolModifier.Abstract;
        }

        if ((flag & PhraseFlag.ModifierPrivate) > 0) {
            symbolModifier |= SymbolModifier.Private;
        }

        if ((flag & PhraseFlag.ModifierProtected) > 0) {
            symbolModifier |= SymbolModifier.Protected;
        }

        if ((flag & PhraseFlag.ModifierPublic) > 0) {
            symbolModifier |= SymbolModifier.Public;
        }

        if ((flag & PhraseFlag.ModifierStatic) > 0) {
            symbolModifier |= SymbolModifier.Static;
        }

        if ((flag & (PhraseFlag.PassByRef | PhraseFlag.ReturnsRef)) > 0) {
            symbolModifier |= SymbolModifier.Reference;
        }

        if ((flag & PhraseFlag.Variadic) === PhraseFlag.Variadic) {
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
            (!this._kindMask || (node.value.kind & this._kindMask) > 0)) {
            this._node = node;
            return true;
        }
        return false;

    }

}

export class PhraseAtPositionSearch implements TreeVisitor<Phrase | Token>{

    private _node: Tree<Phrase | Token>;
    private _position: Position;

    constructor(position: Position) {
        this._position = position;
    }

    get node() {
        return this._node;
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (node.value !== null) {
            return false;
        }

        let start: Position, end: Position;
        if (node.value.hasOwnProperty('phraseType')) {
            start = (<Phrase>node.value).startToken.range.start;
            end = (<Phrase>node.value).endToken.range.end;
        } else {
            return false;
        }

        if (util.isInRange(this._position, start, end) === 0) {
            this._node = <Tree<Phrase>>node;
            return true;
        }

        return false;

    }

}

/**
 * Resolves variable type within a single scope
 */
export class VariableTypeResolver implements TreeVisitor<Phrase | Token>{

    private _haltAtNode: Tree<Phrase | Token>;
    private _haltTraverse: boolean;

    constructor(public variableTable: ResolvedVariableTable,
        public nameResolver: NameResolver,
        public typeResolver: TypeResolver,
        public typeAssigner: TypeAssigner,
        haltAtNode: Tree<Phrase | Token> = null) {
        this._haltAtNode = haltAtNode;
        this._haltTraverse = false;
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (this._haltTraverse) {
            return;
        }

        if (this._haltAtNode === node) {
            this._haltTraverse = true;
            return;
        }

        if (node.value === null) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.Closure:
                return false;
            case PhraseType.IfList:
            case PhraseType.Switch:
                this.variableTable.pushBranchGroup();
                return true;
            case PhraseType.If:
            case PhraseType.Case:
                this.variableTable.pushBranch();
                return true;
            case PhraseType.BinaryExpression:
                if ((<Phrase>node.value).flag === PhraseFlag.BinaryAssign ||
                    (<Phrase>node.value).flag === PhraseFlag.BinaryInstanceOf) {
                    this._binaryExpression(node);
                    return false;
                }
                return true;
            case PhraseType.Foreach:
                this._foreach(node);
                return false;
            default:
                return true;
        }

    }

    postOrder(node: Tree<Phrase | Token>) {

        if (this._haltTraverse) {
            return;
        }

        if (node.value === null) {
            return;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.IfList:
            case PhraseType.Switch:
                this.variableTable.popBranchGroup();
                break;
            case PhraseType.If:
            case PhraseType.Case:
                this.variableTable.popBranch();
                break;
            default:
                break;
        }

    }

    private _binaryExpression(node: Tree<Phrase | Token>) {

        let lhs = node.children[0];
        let rhs = node.children[1];

        if (lhs.value === null ||
            ((<Phrase>lhs.value).phraseType !== PhraseType.Variable &&
                (<Phrase>lhs.value).phraseType !== PhraseType.Array &&
                (<Phrase>lhs.value).phraseType !== PhraseType.Dimension) ||
            rhs.value === null) {
            return;
        }

        let type = this.typeResolver.resolveType(rhs);
        if (!type || type.isEmpty()) {
            return;
        }
        this.typeAssigner.assignType(lhs, type);

    }

    private _foreach(node: Tree<Phrase | Token>) {

        let expr1 = node.children[0];
        let expr3 = node.children[2];

        if (expr3.value === null ||
            ((<Phrase>expr3.value).phraseType !== PhraseType.Variable &&
                (<Phrase>expr3.value).phraseType !== PhraseType.Array &&
                (<Phrase>expr3.value).phraseType !== PhraseType.Dimension) ||
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

    assignType(node: Tree<Phrase | Token>, typeString: TypeString) {

        if (node.value === null) {
            return;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.Array:
                this._array(node, typeString);
            case PhraseType.ArrayPair:
                this._arrayPair(node.children[1], typeString);
                break;
            case PhraseType.Dimension:
                this._dimension(node, typeString);
                break;
            case PhraseType.Variable:
                this._variable(node, typeString);
                break;
            default:
                break;
        }

    }

    private _dimension(node: Tree<Phrase | Token>, typeString: TypeString) {
        this.assignType(node.children[0], typeString.array());
    }

    private _array(node: Tree<Phrase | Token>, typeString: TypeString) {
        let type = typeString.arrayDereference();

        if (!node.children) {
            return;
        }

        for (let n = 0; n < node.children.length; ++n) {
            this._arrayPair(node.children[n], type);
        }
    }

    private _arrayPair(node: Tree<Phrase | Token>, typeString: TypeString) {
        this.assignType(node.children[1], typeString);
    }

    private _variable(node: Tree<Phrase | Token>, typeString: TypeString) {

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

    resolveType(node: Tree<Phrase | Token>): TypeString {

        if (node.value === null) {
            return null;
        }

        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Variable:
                return this._variable(node);
            case PhraseType.Dimension:
                return this._dimension(node);
            case PhraseType.StaticProperty:
            case PhraseType.Property:
                return this._property(node);
            case PhraseType.StaticMethodCall:
            case PhraseType.MethodCall:
                return this._methodCall(node);
            case PhraseType.Call:
                return this._call(node);
            case PhraseType.Name:
                return this._name(node);
            case PhraseType.BinaryExpression:
            //todo assignment chain?
            default:
                return null;
        }

    }

    private _dimension(node: Tree<Phrase | Token>) {

        let typeString = this.resolveType(node.children[0]);
        return typeString ? typeString.arrayDereference() : null;

    }

    private _call(node: Tree<Phrase | Token>) {

        let nameNode = node.children[0];

        if ((<Phrase>nameNode.value).phraseType !== PhraseType.Name) {
            return null;
        }

        let name = nameToFqnString(nameNode, this.nameResolver, SymbolKind.Function);
        if (!name) {
            return null;
        }

        let functionSymbol = this.symbolStore.match(name, SymbolKind.Function).shift();
        return functionSymbol ? functionSymbol.value.type : null;

    }

    private _methodCall(node: Tree<Phrase | Token>) {

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

    private _property(node: Tree<Phrase | Token>) {

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

    private _variable(node: Tree<Phrase | Token>) {

        let child = node.children[0] as Tree<Token>;

        if (child.value === null || child.value.tokenType !== TokenType.T_VARIABLE) {
            return null;
        }

        let text = child.value.text;

        if(text === '$this'){

        } else {

        }

    }

    private _traverseUpAndFindVariableAssignment(varName:string, varNode:Tree<Phrase|Token>){

        let parent = varNode;
        let sibling:Tree<Phrase|Token>;
        while(true){

            sibling = varNode.previousSibling();
            


        }

    }

    private _name(node: Tree<Phrase | Token>) {
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

export class DocumentContext {

    private _tokenIndex: number;
    private _symbol: Tree<PhpSymbol>;
    private _phrase: Tree<Phrase | Token>;

    constructor(public position: Position,
        public parsedDoc: ParsedDocument,
        public docSymbols: DocumentSymbols,
        public symbolStore: SymbolStore) {

    }

    get phrase() {
        if (this._phrase === undefined) {
            let search = new PhraseAtPositionSearch(this.position);
            this.parsedDoc.parseTree.traverse(search);
            this._phrase = search.node;
        }
        return this._phrase;
    }

    get symbol() {
        if (this._symbol === undefined) {
            let search = new SymbolAtLineSearch(this.position.line, 0);
            this.docSymbols.symbolTree.traverse(search);
            this._symbol = search.node;
        }
        return this._symbol;
    }

    get token() {
        return this.parsedDoc.tokens[this.tokenIndex];
    }

    get tokenIndex() {
        if (this._tokenIndex === undefined) {
            this._tokenIndex = this.parsedDoc.tokenIndexAtPosition(this.position);
        }
        return this._tokenIndex;
    }

    get namespace(){
        let s = this.symbol;
  
        if(!s){
            return null;
        }

        if(s.value.kind === SymbolKind.Namespace){
            return s;
        }

        return s.ancestor((x)=>{
            return x.value.kind === SymbolKind.Namespace;
        });
    }

    get classSymbol(){

        let s = this.symbol;
        
        if(!s){
            return null;
        }

        let kindMask = SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait;

        if((s.value.kind & kindMask) > 0){
            return s;
        }

        return s.ancestor((x)=>{
            return (s.value.kind & kindMask) > 0;
        });

    }

    resolveType(node: Tree<Phrase | Token>) {

        if ((<Phrase>node.value).phraseType === PhraseType.Name) {
            return this._typeResolveName(<Tree<Phrase>>node);
        } else if ((<Token>node.value).tokenType === TokenType.T_VARIABLE &&
            (<Token>node.value).text === '$this') {
            return this._typeResolveThis(<Tree<Token>>node);
        }

        let nameResolver = new NameResolver(this.docSymbols.importTable);
        let ns = this.namespace;
        let classSymbol = this.classSymbol;
        nameResolver.namespace = ns ? ns.value.name : '';
        nameResolver.thisName = classSymbol ? classSymbol.value.name : '';
        let varTable = new ResolvedVariableTable();
        let typeResolver = new VariableTypeResolver(new ResolvedVariableTable(),
            nameResolver,
            new TypeResolver(nameResolver, varTable, this.symbolStore),
            new TypeAssigner(varTable),
            node);

    }

    private _namesp

    private _typeResolveThis(token: Tree<Token>) {

    }

    private _typeResolveName(name: Tree<Phrase>) {

    }

}

