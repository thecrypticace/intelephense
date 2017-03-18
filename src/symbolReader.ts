/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, TreeVisitor, Event, BinarySearch, SuffixArray } from './types';
import {
    Phrase, Token, PhraseType, TokenType, NamespaceName, FunctionDeclarationHeader,
    ReturnType, TypeDeclaration, QualifiedName, ParameterDeclarationList,
    ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration,
    ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList,
    InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause,
    TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElementList,
    ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader,
    PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition,
    NamespaceUseDeclaration, NamespaceUseClause, NamespaceAliasingClause, AnonymousClassDeclaration,
    AnonymousClassDeclarationHeader, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable,
    TraitUseClause, SimpleVariable
} from 'php7parser';
import { TextDocument } from './document';
import { ParseTree } from './parseTree';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam } from './phpDoc';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString,
    SymbolModifier, SymbolTree, VariableTable, SymbolStore, DocumentSymbols
} from './symbol';

export class SymbolReader implements TreeVisitor<Phrase | Token> {

    lastPhpDoc: PhpDoc;

    constructor(
        public textDocument: TextDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) {

    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceUseDeclaration:
                
            case PhraseType.NamespaceDefinition:
                
            case PhraseType.ConstElement:
                
            case PhraseType.FunctionDeclarationHeader:

            case undefined:
                this._token(<Token>node);
                return false;
            default:
                return true;
        }

    }

    private _token(t: Token) {
        if (t.tokenType === TokenType.DocumentComment) {
            this.lastPhpDoc = PhpDocParser.parse(SymbolReader.tokenText(t));
        }
    }

    private _addSymbol(symbol: PhpSymbol, pushToSpine: boolean) {

        if (!symbol || !symbol.name) {
            return;
        }

        let parent = this.spine[this.spine.length - 1];
        parent.children.push(symbol);

        if (pushToSpine) {
            this.spine.push(symbol);
        }
    }

}


export namespace SymbolReader {

    export var nameResolver: NameResolver;
    export var textDocument: TextDocument;

    export function tokenText(t: Token) {
        return t ? textDocument.textAtOffset(t.offset, t.length) : null;
    }

    export function nameTokenToFqn(t: Token) {
        let name = tokenText(t);
        return name ? nameResolver.resolveRelative(name) : null;
    }

    export function phraseRange(p: Phrase) {
        if (!p) {
            return null;
        }

        let startToken: Token, endToken: Token;
        [startToken, endToken] = ParseTree.tokenRange(p);

        if (!startToken || !endToken) {
            return null;
        }

        return <Range>{
            start: textDocument.positionAtOffset(startToken.offset),
            end: textDocument.positionAtOffset(endToken.offset + endToken.length)
        }
    }

    export function tagTypeToFqn(type: string) {
        if (!type) {
            return null;
        } else if (type[0] === '\\') {
            return type.slice(1);
        } else {
            return nameResolver.resolveRelative(type);
        }
    }

    /**
     * 
     * Uses phrase range to provide "unique" name
     */
    export function anonymousName(node: Phrase) {
        let range = phraseRange(node);
        let suffix = [range.start.line, range.end.line, range.end.line, range.end.character].join('.');
        return '.anonymous.' + suffix;
    }

    export function functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(tagTypeToFqn(returnTag.typeString));
            }
        }

        return s;

    }

    export function functionDeclarationHeader(node: FunctionDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Parameter,
            name: tokenText(node.name),
            range: phraseRange(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = tagTypeToFqn(tag.typeString);
                s.type = s.type ? s.type.merge(type) : new TypeString(type);
            }
        }

        return s;
    }

    export function typeDeclaration(node: TypeDeclaration) {

        return (<Phrase>node.name).phraseType ?
            qualifiedName(<QualifiedName>node.name, SymbolKind.Class) :
            tokenText(<Token>node.name);

    }

    export function qualifiedName(node: QualifiedName, kind: SymbolKind) {
        if (!node || !node.name) {
            return null;
        }

        let name = namespaceName(node.name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return nameResolver.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return nameResolver.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
            default:
                return name;
        }
    }

    export function constElement(node: ConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            name: nameTokenToFqn(node.name),
            range: phraseRange(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
            }
        }

        return s;

    }

    export function classConstantDeclaration(node: ClassConstDeclaration) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    export function classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            modifiers: modifiers,
            name: identifier(node.name),
            range: phraseRange(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
            }
        }

        return s;

    }

    export function methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(tagTypeToFqn(returnTag.typeString));
            }
        }

        return s;

    }

    export function memberModifierList(node: MemberModifierList) {
        return modifierListElementsToSymbolModifier(node.elements);
    }

    export function methodDeclarationHeader(node: MethodDeclarationHeader) {
        return identifier(node.name);
    }

    export function propertyDeclaration(node: PropertyDeclaration) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    export function propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Property,
            name: tokenText(node.name),
            modifiers: modifiers,
            range: phraseRange(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
            }
        }

        return s;

    }

    export function identifier(node: Identifier) {
        return tokenText(node.name);
    }

    export function interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Interface,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
        }

        return s;

    }

    export function phpDocMembers(phpDoc: PhpDoc) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n]));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n]));
        }

        return symbols;
    }

    export function methodTagToSymbol(tag: Tag) {
        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            modifiers: SymbolModifier.Magic,
            name: tag.name,
            type: new TypeString(tagTypeToFqn(tag.typeString)),
            description: tag.description,
            children: []
        };

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n]));
        }

        return s;
    }

    export function magicMethodParameterToSymbol(p: MethodTagParam) {

        return <PhpSymbol>{
            kind: SymbolKind.Parameter,
            name: p.name,
            modifiers: SymbolModifier.Magic,
            type: new TypeString(tagTypeToFqn(p.typeString))
        }

    }

    export function propertyTagToSymbol(t: Tag) {
        return <PhpSymbol>{
            kind: SymbolKind.Property,
            name: t.name,
            modifiers: magicPropertyModifier(t) | SymbolModifier.Magic,
            type: new TypeString(tagTypeToFqn(t.typeString)),
            description: t.description
        };
    }

    export function magicPropertyModifier(t: Tag) {
        switch (t.tagName) {
            case '@property-read':
                return SymbolModifier.ReadOnly;
            case '@property-write':
                return SymbolModifier.WriteOnly;
            default:
                return SymbolModifier.None;
        }
    }

    export function interfaceDeclarationHeader(node: InterfaceDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function interfaceBaseClause(node: InterfaceBaseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            };
        }
        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    export function traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc) {
        let s: PhpSymbol = {
            kind: SymbolKind.Trait,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
        }

        return s;
    }

    export function traitDeclarationHeader(node: TraitDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Class,
            name: null,
            range: phraseRange(node),
            children: []
        };

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
        }

        return s;

    }

    export function classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader) {

        if (node.modifier) {
            s.modifiers = modifierTokenToSymbolModifier(node.modifier);
        }

        s.name = nameTokenToFqn(node.name);
        return s;

    }

    export function classBaseClause(node: ClassBaseClause) {
        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: qualifiedName(node.name, SymbolKind.Class)
        };
    }

    export function classInterfaceClause(node: ClassInterfaceClause) {

        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            }
        }

        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);

    }

    export function traitUseClause(node: TraitUseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Trait,
                name: name
            };
        };

        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    export function anonymousClassDeclaration(node: AnonymousClassDeclaration) {

        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: anonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            range: phraseRange(node)
        };
    }

    export function anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression) {

        return <PhpSymbol>{
            kind: SymbolKind.Function,
            name: anonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            range: phraseRange(node)
        };

    }

    export function anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable) {
        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: tokenText(node.name)
        };
    }

    export function simpleVariable(node: SimpleVariable) {
        if (!node.name || (<Token>node.name).tokenType !== TokenType.VariableName) {
            return null;
        }

        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: tokenText(<Token>node.name)
        };
    }

    export function qualifiedNameList(node: QualifiedNameList) {

        let names: string[] = [];
        let name: string;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = qualifiedName(node.elements[n], SymbolKind.Class);
            if (name) {
                names.push(name);
            }
        }
        return names;

    }

    export function modifierListElementsToSymbolModifier(tokens: Token[]) {

        let flag = SymbolModifier.None;
        if (!tokens || tokens.length < 1) {
            return flag
        }

        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= modifierTokenToSymbolModifier(tokens[n]);
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

    export function namespaceName(node: NamespaceName) {

        if (!node || !node.parts || node.parts.length < 1) {
            return null;
        }

        let parts: string[] = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(tokenText(node.parts[n]));
        }

        return parts.join('\\');

    }

    function concatNamespaceName(prefix: string, name: string) {
        if (!name) {
            return null;
        } else if (!prefix) {
            return name;
        } else {
            return prefix + '\\' + name;
        }
    }

    function namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        return <ImportRule>{
            kind: kind ? kind : SymbolKind.Class,
            fqn: concatNamespaceName(prefix, namespaceName(node.name)),
            alias: node.aliasingClause ? tokenText(node.aliasingClause.alias) : null
        };

    }

    export function tokenToSymbolKind(t: Token) {
        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    export function namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string] {

        return [
            node.kind ? tokenToSymbolKind(node.kind) : SymbolKind.None,
            node.prefix ? namespaceName(node.prefix) : null
        ];

    }

    export function namespaceDefinition(node: NamespaceDefinition) {

        return <PhpSymbol>{
            kind: SymbolKind.Namespace,
            name: namespaceName(node.name),
            range: phraseRange(node),
            children: []
        };

    }

}