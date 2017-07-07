/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { NameResolverVisitor } from './nameResolverVisitor';
import { TreeVisitor, MultiVisitor } from './types';
import { ParsedDocument, NodeTransform, TokenTransform } from './parsedDocument';
import {
    Phrase, PhraseType, Token, TokenType
} from 'php7parser';
import { PhpDoc, PhpDocParser, Tag, MethodTagParam } from './phpDoc';
import { PhpSymbol, SymbolKind, SymbolModifier, PhpSymbolDoc } from './symbol';
import { NameResolver } from './nameResolver';
import { TypeString } from './typeString';
import { Location } from 'vscode-languageserver-types';


export class SymbolReader extends MultiVisitor<Phrase | Token> {

    private _symbolVisitor: SymbolVisitor;

    constructor(
        nameResolverVisitor: NameResolverVisitor,
        symbolVisitor: SymbolVisitor
    ) {
        super([nameResolverVisitor, symbolVisitor]);
        this._symbolVisitor = symbolVisitor;
    }

    set externalOnly(v: boolean) {
        this._symbolVisitor.externalOnly = v;
    }

    get spine() {
        return this._symbolVisitor.spine;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, spine: PhpSymbol[]) {
        return new SymbolReader(
            new NameResolverVisitor(document, nameResolver),
            new SymbolVisitor(document, nameResolver, spine)
        );
    }

}

export class SymbolVisitor implements TreeVisitor<Phrase | Token> {

    private static _varAncestors = [
        PhraseType.ListIntrinsic, PhraseType.ForeachKey, PhraseType.ForeachValue,
        PhraseType.ByRefAssignmentExpression, PhraseType.CompoundAssignmentExpression,
        PhraseType.SimpleAssignmentExpression
    ];

    private static _builtInTypes = [
        'array', 'callable', 'int', 'string', 'bool', 'float', 'iterable'
    ];

    private static _globalVars = [
        '$GLOBALS',
        '$_SERVER',
        '$_GET',
        '$_POST',
        '$_FILES',
        '$_REQUEST',
        '$_SESSION',
        '$_ENV',
        '$_COOKIE',
        '$php_errormsg',
        '$HTTP_RAW_POST_DATA',
        '$http_response_header',
        '$argc',
        '$argv',
        '$this'
    ];

    lastPhpDoc: PhpDoc;
    lastPhpDocLocation: Location;
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string = '';
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;
    externalOnly = false;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) {
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let s: PhpSymbol;

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                s = this.namespaceDefinition(<NamespaceDefinition>node);
                this._addSymbol(s, false);
                return true;

            case PhraseType.NamespaceUseDeclaration:
                this.namespaceUseDeclarationKind = this._tokenToSymbolKind((<NamespaceUseDeclaration>node).kind);
                this.namespaceUseDeclarationPrefix = this.document.nodeText((<NamespaceUseDeclaration>node).prefix);
                return true;

            case PhraseType.NamespaceUseClause:
                s = this.namespaceUseClause(<NamespaceUseClause>node,
                    this.namespaceUseDeclarationKind,
                    this.namespaceUseDeclarationPrefix
                );

                this._addSymbol(s, false);
                return false;

            case PhraseType.ConstElement:
                this._addSymbol(this.constElement(<ConstElement>node, this.lastPhpDoc), false);
                return false;

            case PhraseType.FunctionDeclaration:
                this._addSymbol(
                    this.functionDeclaration(<FunctionDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.FunctionDeclarationHeader:
                this.functionDeclarationHeader(this._top(), <FunctionDeclarationHeader>node);
                return true;

            case PhraseType.ParameterDeclaration:
                this._addSymbol(
                    this.parameterDeclaration(<ParameterDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.TypeDeclaration:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = this.typeDeclaration(<TypeDeclaration>node);
                if (typeDeclarationValue) {
                    s.type = typeDeclarationValue;
                }
                return false;

            case PhraseType.ClassDeclaration:
                this._addSymbol(
                    this.classDeclaration(<ClassDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.ClassDeclarationHeader:
                this.classDeclarationHeader(
                    this.spine[this.spine.length - 1],
                    <ClassDeclarationHeader>node
                );
                return true;

            case PhraseType.ClassBaseClause:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = this.classBaseClause(<ClassBaseClause>node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                } else {
                    s.associated = [classBaseClause];
                }
                return false;

            case PhraseType.ClassInterfaceClause:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = this.classInterfaceClause(<ClassInterfaceClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                } else {
                    s.associated = classInterfaceClause;
                }
                return false;

            case PhraseType.InterfaceDeclaration:
                this._addSymbol(
                    this.interfaceDeclaration(<InterfaceDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.InterfaceDeclarationHeader:
                this.interfaceDeclarationHeader(this._top(), <InterfaceDeclarationHeader>node);
                return false;

            case PhraseType.InterfaceBaseClause:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = this.interfaceBaseClause(<InterfaceBaseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                } else {
                    s.associated = interfaceBaseClause;
                }
                return false;

            case PhraseType.TraitDeclaration:
                this._addSymbol(
                    this.traitDeclaration(<TraitDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.TraitDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    this.traitDeclarationHeader(<TraitDeclarationHeader>node);
                return false;

            case PhraseType.ClassConstDeclaration:
                this.classConstDeclarationModifier =
                    this.classConstantDeclaration(<ClassConstDeclaration>node);
                return true;

            case PhraseType.ClassConstElement:
                this._addSymbol(
                    this.classConstElement(
                        this.classConstDeclarationModifier,
                        <ClassConstElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.PropertyDeclaration:
                this.propertyDeclarationModifier =
                    this.propertyDeclaration(<PropertyDeclaration>node);
                return true;

            case PhraseType.PropertyElement:
                this._addSymbol(
                    this.propertyElement(
                        this.propertyDeclarationModifier,
                        <PropertyElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.TraitUseClause:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = this.traitUseClause(<TraitUseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                } else {
                    s.associated = traitUseClause;
                }
                return false;

            case PhraseType.MethodDeclaration:
                this._addSymbol(
                    this.methodDeclaration(<MethodDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.MethodDeclarationHeader:
                this.methodDeclarationHeader(this._top(), <MethodDeclarationHeader>node);
                return true;

            case PhraseType.AnonymousClassDeclaration:
                this._addSymbol(
                    this.anonymousClassDeclaration(<AnonymousClassDeclaration>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionCreationExpression:
                this._addSymbol(
                    this.anonymousFunctionCreationExpression(<AnonymousFunctionCreationExpression>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionUseVariable:
                this._addSymbol(
                    this.anonymousFunctionUseVariable(<AnonymousFunctionUseVariable>node),
                    false
                );
                return false;

            case PhraseType.SimpleVariable:

                if (!this._shouldReadVar(spine)) {
                    return false;
                }

                s = this.simpleVariable(<SimpleVariable>node);
                if (s && SymbolVisitor._globalVars.indexOf(s.name) < 0 && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;

            case PhraseType.CatchClause:

                s = {
                    kind: SymbolKind.Variable,
                    name: this.document.nodeText((<CatchClause>node).variable),
                    location: this.document.nodeLocation((<CatchClause>node).variable)
                }

                if (!this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return true;

            case PhraseType.FunctionDeclarationBody:
            case PhraseType.MethodDeclarationBody:
                return !this.externalOnly;

            case PhraseType.FunctionCallExpression:
                //define
                s = this.functionCallExpression(<FunctionCallExpression>node);
                if (s) {
                    this._addSymbol(s, false);
                }

                return false;

            case undefined:
                this._token(<Token>node);
                return false;

            default:
                return true;
        }

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclaration:
            case PhraseType.ParameterDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this.spine.pop();
                break;
            case PhraseType.PropertyDeclaration:
                this.propertyDeclarationModifier = 0;
                break;
            case PhraseType.ClassConstDeclaration:
                this.classConstDeclarationModifier = 0;
                break;
            case PhraseType.NamespaceUseDeclaration:
                this.namespaceUseDeclarationKind = 0;
                this.namespaceUseDeclarationPrefix = '';
                break;
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.AnonymousFunctionHeader:
            case PhraseType.AnonymousClassDeclarationHeader:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }

    }

    private _tokenToSymbolKind(t: Token) {

        if (!t) {
            return SymbolKind.None;
        }

        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    private _shouldReadVar(spine: (Phrase | Token)[]) {

        for (let n = spine.length - 1; n >= 0; --n) {
            if (SymbolVisitor._varAncestors.indexOf((<Phrase>spine[n]).phraseType) > -1) {
                return true;
            }
        }

        return false;

    }

    private _top() {
        return this.spine[this.spine.length - 1];
    }

    private _variableExists(name: string) {
        let parent = this.spine[this.spine.length - 1];

        if (!parent.children) {
            return false;
        }

        let mask = SymbolKind.Parameter | SymbolKind.Variable;
        let s: PhpSymbol;

        for (let n = 0, l = parent.children.length; n < l; ++n) {
            s = parent.children[n];
            if ((s.kind & mask) > 0 && s.name === name) {
                return true;
            }
        }

        return false;
    }

    private _token(t: Token) {

        switch (t.tokenType) {
            case TokenType.DocumentComment:
                let phpDocTokenText = this.document.nodeText(t);
                this.lastPhpDoc = PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = this.document.nodeLocation(t);
                break;
            case TokenType.CloseBrace:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }

    private _addSymbol(symbol: PhpSymbol, pushToSpine: boolean) {

        if (!symbol) {
            return;
        }

        let parent = this.spine[this.spine.length - 1];

        if (!parent.children) {
            parent.children = [];
        }

        if (parent.name) {
            symbol.scope = parent.name;
        }

        parent.children.push(symbol);

        if (pushToSpine) {
            this.spine.push(symbol);
        }

    }

    argListToStringArray(node: ArgumentExpressionList) {

        let textArray: string[] = [];

        for (let n = 0, l = node.elements.length; n < l; ++n) {
            textArray.push(this.document.nodeText(node.elements[n]));
        }
        return textArray;
    }

    functionCallExpression(node: FunctionCallExpression) {
        let fnName = this.document.nodeText(node.callableExpr);
        if (fnName.length && fnName[0] === '\\') {
            fnName = fnName.slice(1);
        }

        if (fnName.toLowerCase() !== 'define' || !node.argumentList) {
            return null;
        }

        let argTextArray = this.argListToStringArray(node.argumentList);
        let name = argTextArray.shift().slice(1, -1);
        if (name && name[0] === '\\') {
            name = name.slice(1);
        }
        let value = argTextArray.shift();

        return <PhpSymbol>{
            kind: SymbolKind.Constant,
            name: name,
            value: value
        }
    }

    nameTokenToFqn(t: Token) {
        return this.nameResolver.resolveRelative(this.document.nodeText(t));
    }

    functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        }

        if (phpDoc) {
            let returnTag = phpDoc.returnTag;
            s.doc = PhpSymbolDoc.create(
                phpDoc.text,
                returnTag ? TypeString.nameResolve(returnTag.typeString, this.nameResolver) : ''
            );
        }

        return s;

    }

    functionDeclarationHeader(s: PhpSymbol, node: FunctionDeclarationHeader) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }

    parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Parameter,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, this.nameResolver));
            }
        }

        if (node.value) {
            s.value = this.document.nodeText(node.value);
        }

        return s;
    }

    typeDeclaration(node: TypeDeclaration) {

        if (!node.name) {
            return '';
        }

        if (ParsedDocument.isPhrase(node)) {

            let text = this._namePhraseToFqn(<any>node.name, SymbolKind.Class);
            let notFqn = PhpSymbol.notFqn(text);
            if (SymbolVisitor._builtInTypes.indexOf(notFqn) > -1) {
                return notFqn;
            }
            return text;

        } else {
            return this.document.nodeText(<Token>node.name);
        }


    }

    private _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        let text = this.document.nodeText((<QualifiedName>node).name, [TokenType.Comment, TokenType.Whitespace]);

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(text);
            case PhraseType.FullyQualifiedName:
                return text;
            default:
                return '';
        }
    }

    constElement(node: ConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            name: this.nameTokenToFqn(node.name),
            location: this.document.nodeLocation(node),
            value: this.document.nodeText(node.value)
        };

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, this.nameResolver));
            }
        }

        return s;

    }

    classConstantDeclaration(node: ClassConstDeclaration) {
        return node.modifierList ?
            SymbolReader.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.Public;
    }

    classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.ClassConstant,
            modifiers: modifiers,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            value: this.document.nodeText(node.value)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, this.nameResolver));
            }
        }

        return s;

    }

    methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        }

        if (phpDoc) {
            let returnTag = phpDoc.returnTag;
            s.doc = PhpSymbolDoc.create(
                phpDoc.text,
                returnTag ? TypeString.nameResolve(returnTag.typeString, this.nameResolver) : ''
            );
        }

        return s;

    }

    memberModifierList(node: MemberModifierList) {
        return SymbolReader.modifierListElementsToSymbolModifier(node.elements);
    }

    methodDeclarationHeader(s: PhpSymbol, node: MethodDeclarationHeader) {
        s.name = this.identifier(node.name);
        if (node.modifierList) {
            s.modifiers = this.memberModifierList(node.modifierList);
        }

        return s;
    }

    propertyDeclaration(node: PropertyDeclaration) {
        return node.modifierList ?
            SymbolReader.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Property,
            name: this.document.nodeText(node.name),
            modifiers: modifiers,
            location: this.document.nodeLocation(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, this.nameResolver));
            }
        }

        return s;

    }

    identifier(node: Identifier) {
        return this.document.nodeText(node.name);
    }

    interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Interface,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        }

        if (phpDoc) {
            s.doc = PhpSymbolDoc.create(phpDoc.text);
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    phpDocMembers(phpDoc: PhpDoc, phpDocLoc: Location) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.propertyTagToSymbol(magic[n], phpDocLoc));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.methodTagToSymbol(magic[n], phpDocLoc));
        }

        return symbols;
    }

    methodTagToSymbol(tag: Tag, phpDocLoc: Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            modifiers: SymbolModifier.Magic,
            name: tag.name,
            doc: PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, this.nameResolver)),
            children: [],
            location: phpDocLoc
        };

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(this.magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }

        return s;
    }

    magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc: Location) {

        return <PhpSymbol>{
            kind: SymbolKind.Parameter,
            name: p.name,
            modifiers: SymbolModifier.Magic,
            doc: PhpSymbolDoc.create('', TypeString.nameResolve(p.typeString, this.nameResolver)),
            location: phpDocLoc
        }

    }

    propertyTagToSymbol(t: Tag, phpDocLoc: Location) {
        return <PhpSymbol>{
            kind: SymbolKind.Property,
            name: t.name,
            modifiers: this.magicPropertyModifier(t) | SymbolModifier.Magic,
            doc: PhpSymbolDoc.create('', TypeString.nameResolve(t.typeString, this.nameResolver)),
            description: t.description,
            location: phpDocLoc
        };
    }

    magicPropertyModifier(t: Tag) {
        switch (t.tagName) {
            case '@property-read':
                return SymbolModifier.ReadOnly;
            case '@property-write':
                return SymbolModifier.WriteOnly;
            default:
                return SymbolModifier.None;
        }
    }

    interfaceDeclarationHeader(s: PhpSymbol, node: InterfaceDeclarationHeader) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }

    interfaceBaseClause(node: InterfaceBaseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            };
        }
        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Trait,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        }

        if (phpDoc) {
            s.doc = {
                description: phpDoc.text
            };
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;
    }

    traitDeclarationHeader(node: TraitDeclarationHeader) {
        return this.nameTokenToFqn(node.name);
    }

    classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Class,
            name: '',
            location: this.document.nodeLocation(node),
            children: []
        };

        if (phpDoc) {
            s.doc = {
                description: phpDoc.text
            }

            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader) {

        if (node.modifier) {
            s.modifiers = SymbolReader.modifierTokenToSymbolModifier(node.modifier);
        }

        s.name = this.nameTokenToFqn(node.name);
        return s;

    }

    classBaseClause(node: ClassBaseClause) {
        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: this._namePhraseToFqn(node.name, SymbolKind.Class)
        };
    }

    stringToInterfaceSymbolStub(text: string) {
        return <PhpSymbol>{
            kind: SymbolKind.Interface,
            name: text
        };
    }

    classInterfaceClause(node: ClassInterfaceClause) {
        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(this.stringToInterfaceSymbolStub);
    }

    stringToTraitSymbolStub(text: string) {
        return <PhpSymbol>{
            kind: SymbolKind.Trait,
            name: text
        };
    }

    traitUseClause(node: TraitUseClause) {
        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(this.stringToTraitSymbolStub);
    }

    anonymousClassDeclaration(node: AnonymousClassDeclaration) {

        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: this.document.createAnonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: this.document.nodeLocation(node)
        };
    }

    anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression) {

        return <PhpSymbol>{
            kind: SymbolKind.Function,
            name: this.document.createAnonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: this.document.nodeLocation(node)
        };

    }

    anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable) {
        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            modifiers: SymbolModifier.Use
        };
    }

    simpleVariable(node: SimpleVariable) {
        if (!ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
            return null;
        }

        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: this.document.nodeText(<Token>node.name),
            location: this.document.nodeLocation(node)
        };
    }

    qualifiedNameList(node: QualifiedNameList) {

        let names: string[] = [];
        let name: string;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = this._namePhraseToFqn(node.elements[n], SymbolKind.Class);
            if (name) {
                names.push(name);
            }
        }
        return names;

    }

    namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let fqn = this.nameResolver.concatNamespaceName(prefix, this.document.nodeText(node.name));
        if (!kind) {
            kind = SymbolKind.Class;
        }

        return <PhpSymbol>{
            kind: kind,
            name: node.aliasingClause ? this.document.nodeText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }],
            location: this.document.nodeLocation(node),
            modifiers: SymbolModifier.Use
        };

    }

    namespaceDefinition(node: NamespaceDefinition) {

        return <PhpSymbol>{
            kind: SymbolKind.Namespace,
            name: this.document.nodeText(node.name),
            location: this.document.nodeLocation(node),
            children: []
        };

    }

}

class TraitDeclarationHeader implements NodeTransform {

    value: string;
    phraseType = PhraseType.TraitDeclarationHeader;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value = this.nameResolver.resolveRelative(transform.value);
        }
    }

}

class InterfaceBaseClauseTransform implements NodeTransform {

    value: PhpSymbol[];
    phraseType = PhraseType.InterfaceBaseClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.QualifiedNameList) {
            let v = transform.value as string[];
            for (let n = 0; n < v.length; ++n) {
                this.value.push({
                    kind: SymbolKind.Interface,
                    name: v[n]
                });
            }
        }
    }

}

class InterfaceDeclarationHeaderTransform implements NodeTransform {

    value: [string, PhpSymbol[]];
    phraseType = PhraseType.InterfaceDeclarationHeader;

    constructor(public nameResolver: NameResolver) {
        this.value = new Array(2) as [string, PhpSymbol[]];
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value[0] = this.nameResolver.resolveRelative(transform.value);
        } else if (transform.phraseType === PhraseType.InterfaceBaseClause) {
            this.value[1] = transform.value;
        }
    }

}

class TraitUseClauseTransform implements NodeTransform {

    value: PhpSymbol[];
    PhraseType = PhraseType.TraitUseClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.QualifiedNameList) {
            let tVal = transform.value as string[];
            for (let n = 0, l = tVal.length; n < l; ++n) {
                this.value.push({
                    kind: SymbolKind.Trait,
                    name: tVal[n]
                });
            }
        }
    }

}

class ClassInterfaceClauseTransform implements NodeTransform {
    value: PhpSymbol[];
    phraseType = PhraseType.ClassInterfaceClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType !== PhraseType.QualifiedNameList) {
            return;
        }

        for (let n = 0; n < transform.value.length; ++n) {
            this.value.push({
                kind: SymbolKind.Interface,
                name: transform.value[n]
            });
        }
    }
}

class QualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.QualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveNotFullyQualified(transform.value);
        }
    }

}

class RelativeQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.RelativeQualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveRelative(transform.value);
        }
    }

}

class FullyQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.FullyQualifiedName;

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = transform.value;
        }
    }

}

class NamespaceDefinitionTransform implements NodeTransform {

    value: PhpSymbol;
    phraseType = PhraseType.NamespaceDefinition;

    constructor(location: Location) {
        this.value = {
            kind: SymbolKind.Namespace,
            name: undefined,
            location: location
        };
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value.name = transform.value;
        }
    }

}

class ClassDeclarationHeaderTransform implements NodeTransform {

    value: [SymbolModifier, string, PhpSymbol, PhpSymbol[]];
    phraseType = PhraseType.ClassDeclarationHeader;

    constructor(public nameResolver: NameResolver) {
        this.value = new Array(4) as [SymbolModifier, string, PhpSymbol, PhpSymbol[]];
    }

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.ClassModifiers:
                this.value[0] = transform.value;
                break;

            case PhraseType.ClassBaseClause:
                this.value[2] = transform.value;
                break;

            case PhraseType.ClassInterfaceClause:
                this.value[3] = transform.value;
                break;

            case undefined:
                if (transform.tokenType === TokenType.Name) {
                    this.value[1] = this.nameResolver.resolveRelative(transform.value);
                }
                break;

            default:
                break;

        }
    }

}

class ClassBaseClauseTransform implements NodeTransform {

    value: PhpSymbol;
    phraseType = PhraseType.ClassBaseClause;

    constructor(public nameResolver: NameResolver) {
        this.value = {
            kind: SymbolKind.Class,
            name: undefined
        };
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value.name = this.nameResolver.resolveRelative(<string>transform.value);
        }
    }

}

class QualifiedNameListTransform implements NodeTransform {

    value: string[];
    phraseType = PhraseType.QualifiedNameList;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.FullyQualifiedName:
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
                this.value.push(transform.value);
                break;
            default:
                break;
        }
    }

}

class MemberModifierListTransform implements NodeTransform {

    value: SymbolModifier = SymbolModifier.None;
    phraseType = PhraseType.MemberModifierList;

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Public:
                this.value |= SymbolModifier.Public;
                break;
            case TokenType.Protected:
                this.value |= SymbolModifier.Protected;
                break;
            case TokenType.Private:
                this.value |= SymbolModifier.Private;
                break;
            case TokenType.Abstract:
                this.value |= SymbolModifier.Abstract;
                break;
            case TokenType.Final:
                this.value |= SymbolModifier.Final;
                break;
            case TokenType.Static:
                this.value |= SymbolModifier.Static;
                break;
            default:
                break;
        }
    }

}

class ClassConstantElementTransform implements NodeTransform {

    value: PhpSymbol;
    PhraseType = PhraseType.ClassConstElement;

    constructor() {
        this.value = {
            kind: SymbolKind.ClassConstant,
            name: ''
        };
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.Identifier) {
            this.value.name = transform.value;
        } else if (transform.phraseType !== PhraseType.Error && transform.tokenType !== TokenType.Equals) {
            this.value.value = transform.value;
        }
    }

}

class DelimiteredListTransform implements NodeTransform {

    value: any[];

    constructor(public phraseType: PhraseType, public delimiter: TokenType) {
        this.value = [];
    }

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Comment:
            case TokenType.DocumentComment:
            case TokenType.Whitespace:
            case this.delimiter:
                break;
            default:
                if (transform.phraseType !== PhraseType.Error) {
                    this.value.push(transform.value);
                }
                break;
        }
    }

}

class MethodDeclarationTransform implements NodeTransform {

    value:PhpSymbol;
    phraseType = PhraseType.MethodDeclaration;

    constructor(location:Location) {
        this.value = {
            kind:SymbolKind.Method,
            name:'',
            location:location
        };
    }

    push(transform:NodeTransform) {

        if(transform.phraseType === PhraseType.MethodDeclarationHeader) {

        }

    }

}

class MethodDeclarationHeaderTransform implements NodeTransform {

    

}

class PropertyInitialiserTransform implements NodeTransform {

    value:string = '';
    phraseType = PhraseType.PropertyInitialiser;

    push(transform:NodeTransform) {
        switch(transform.tokenType) {
            case TokenType.Comment:
            case TokenType.Whitespace:
            case TokenType.DocumentComment:
            case TokenType.Equals:
                break;
            default:
                if(transform.phraseType !== PhraseType.Error) {
                    this.value = transform.value;
                }
                break;
        }
    }

}

class PropertyElementTransform implements NodeTransform {

    value:PhpSymbol;
    phraseType = PhraseType.PropertyElement;

    constructor() {
        this.value = {
            kind:SymbolKind.Property,
            name:''
        }
    }

    push(transform:NodeTransform) {

        if(transform.tokenType === TokenType.VariableName) {
            this.value.name = transform.value;
        } else if (transform.phraseType === PhraseType.PropertyInitialiser) {
            this.value.value = transform.value;
        }

    }

}

class FieldDeclarationTransform implements NodeTransform {

    private _modifier: SymbolModifier = 0;
    value: PhpSymbol[];

    constructor(
        public phraseType: PhraseType,
        public elementListPhraseType: PhraseType
    ) {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.MemberModifierList) {
            this._modifier = transform.value;
        } else if (transform.phraseType === this.elementListPhraseType) {
            this.value = transform.value as PhpSymbol[];
            let modifier = this._modifier > 0 ? this._modifier : SymbolModifier.Public;
            for (let n = 0; n < this.value.length; ++n) {
                this.value[n].modifiers = modifier;
            }
        }
    }

}

class DefaultNodeTransform implements NodeTransform {

    value = '';

    constructor(public phraseType: PhraseType) { }

    push(transform: NodeTransform) {
        this.value += transform.value;
    }

}

export namespace SymbolReader {
    export function modifierListElementsToSymbolModifier(tokens: Token[]) {

        let flag = SymbolModifier.None;
        if (!tokens || tokens.length < 1) {
            return flag;
        }

        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= this.modifierTokenToSymbolModifier(tokens[n]);
        }

        return flag;
    }

    export function modifierTokenToSymbolModifier(t: Token) {
        switch (t.tokenType) {
            case TokenType.Public:
                return SymbolModifier.Public;
            case TokenType.Protected:
                return SymbolModifier.Protected;
            case TokenType.Private:
                return SymbolModifier.Private;
            case TokenType.Abstract:
                return SymbolModifier.Abstract;
            case TokenType.Final:
                return SymbolModifier.Final;
            case TokenType.Static:
                return SymbolModifier.Static;
            default:
                return SymbolModifier.None;
        }

    }

}