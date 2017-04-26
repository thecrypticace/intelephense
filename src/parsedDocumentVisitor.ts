/* 
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 * 
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import { NameResolver } from './nameResolver';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import {
    Phrase, PhraseType, Token, TokenType, NamespaceDefinition, NamespaceUseDeclaration,
    NamespaceUseClause, QualifiedName, FullyQualifiedName, RelativeQualifiedName,
    NamespaceName, ClassDeclarationHeader, AnonymousClassDeclarationHeader,
    AnonymousClassDeclaration
} from 'php7parser';
import { TreeTraverser, TreeVisitor } from './types';

/**
 * Base class for parsed document visitors.
 * This class comes equipped with a name resolver that will collect namespace definition
 * and use declaration symbols (or come prepopulated with them) for use in resolving fully qualified names
 * 
 * Don't return false when visiting namespace definitions and namespace use declarations -- name resolving will be buggy
 * 
 * If not descending into children and wishinf to halt make sure to use _containsHaltOffset
 * _preorder still runs on the token containing the haltOffset.
 * 
 */
export abstract class ParsedDocumentVisitor implements TreeVisitor<Phrase | Token> {

    private _namespaceUseDeclarationKind: SymbolKind;
    private _namespaceUseDeclarationPrefix: string;

    haltTraverse = false;
    haltAtOffset = -1;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver
    ) {
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if(this.haltTraverse){
            return false;
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                this.nameResolver.namespace = this._namespaceNamePhraseToString((<NamespaceDefinition>node).name);
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind((<NamespaceUseDeclaration>node).kind);
                this._namespaceUseDeclarationPrefix = this._namespaceNamePhraseToString((<NamespaceUseDeclaration>node).prefix);
                break;

            case PhraseType.NamespaceUseClause:
                this.nameResolver.rules.push(this._namespaceUseClause(
                    <NamespaceUseClause>node,
                    this._namespaceUseDeclarationKind,
                    this._namespaceUseDeclarationPrefix
                ));
                break;

            case PhraseType.AnonymousClassDeclarationHeader:
                this.nameResolver.pushClassName(this._anonymousClassDeclaration(<AnonymousClassDeclaration>node));
                break;

            case PhraseType.ClassDeclarationHeader:
                this.nameResolver.pushClassName(this._classDeclarationHeader(<ClassDeclarationHeader>node));
                break;

            case undefined:
                //tokens
                if(ParsedDocument.isOffsetInToken(this.haltAtOffset, <Token>node)){
                    this.haltTraverse = true;
                }
                break;

            default:
                break;
        }

        return this._preorder(node, spine);

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this.nameResolver.namespace = '';
                }
                break;
            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = 0;
                this._namespaceUseDeclarationPrefix = '';
                break;
            case PhraseType.ClassDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this.nameResolver.popClassName();
                break;
            default:
                break;
        }

        return this._postorder(node, spine);

    }

    private _classDeclarationHeader(node: ClassDeclarationHeader) {
        let names: [string, string] = [
            this.nameResolver.resolveRelative(this._namespaceNamePhraseToString(node.name)),
            ''
        ];

        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _anonymousClassDeclaration(node: AnonymousClassDeclaration) {
        let names: [string, string] = [
            this._createAnonymousName(node),
            ''
        ];

        if (node.header.baseClause) {
            names[1] = this._namePhraseToFqn(node.header.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let fqn = this.nameResolver.concatNamespaceName(prefix, this._namespaceNamePhraseToString(node.name));

        if (!kind) {
            kind = SymbolKind.Class;
        }

        return <PhpSymbol>{
            kind: kind,
            name: node.aliasingClause ? this._nodeText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }]
        };

    }

    protected _tokenToSymbolKind(t: Token) {

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

    protected _namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string] {
        return [this._tokenToSymbolKind(node.kind), this._namespaceNamePhraseToString(node.prefix)];
    }

    protected abstract _preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    protected abstract _postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;

    protected _containsHaltOffset(node: Phrase | Token) {
        return ParsedDocument.isOffsetInNode(this.haltAtOffset, node);
    }

    protected _nodeText(node: Phrase | Token, ignore?: TokenType[]) {
        return this.document.nodeText(node, ignore);
    }

    protected _nodeRange(node: Phrase | Token) {
        return this.document.nodeRange(node);
    }

    protected _nodeLocation(node: Phrase | Token) {
        return this.document.nodeLocation(node);
    }

    protected _createAnonymousName(node: Phrase) {
        return this.document.createAnonymousName(node);
    }

    /**
     * Resolves name node to FQN
     * @param node 
     * @param kind needed to resolve qualified names against import rules
     */
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(this._namespaceNamePhraseToString((<QualifiedName>node).name), kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(this._namespaceNamePhraseToString((<RelativeQualifiedName>node).name));
            case PhraseType.FullyQualifiedName:
                return this._namespaceNamePhraseToString((<FullyQualifiedName>node).name);
            case PhraseType.NamespaceName:
                return this._namespaceNamePhraseToString(<NamespaceName>node);
            default:
                return '';
        }
    }

    protected _namespaceNamePhraseToString(node: Phrase | Token) {

        if (!ParsedDocument.isPhrase(node, [PhraseType.NamespaceName])) {
            return '';
        }

        return this.document.nodeText(node, [TokenType.Comment, TokenType.Whitespace]);

    }
}